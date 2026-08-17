'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');
const commandService = require('./elanUnifiedOwnerCommandService');
const connect = require('./ownerBusinessConnectClient');

const DEFAULT_OWNER_PHONE = '50588388940';
const DEFAULT_STATE_FILE = '/opt/elankav/state/seller-recruitment-state.json';
const STATE_TTL_MS = 72 * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizePhone(value) {
  if (String(value || '').toLowerCase().includes('@lid')) return '';
  const digits = String(value || '').split('@')[0].replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 8 ? `505${digits}` : digits;
}

function ownerPhones(env = process.env) {
  const configured = String(env.ORCHESTRATOR_OWNER_PHONES || env.ORCHESTRATOR_OWNER_PHONE || '')
    .split(',')
    .map(normalizePhone)
    .filter(Boolean);
  return configured.length ? configured : [DEFAULT_OWNER_PHONE];
}

function isOwnerIdentity({ phone, externalUserId } = {}, env = process.env) {
  const candidate = normalizePhone(phone) || normalizePhone(externalUserId);
  return Boolean(candidate && ownerPhones(env).includes(candidate));
}

function stateFile(env = process.env) {
  return String(env.OWNER_SELLER_RECRUITMENT_STATE_FILE || DEFAULT_STATE_FILE).trim();
}

function readState(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(env), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

function writeState(store, env = process.env) {
  const file = stateFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function pruneState(store, now = Date.now()) {
  const sessions = store?.sessions && typeof store.sessions === 'object' ? store.sessions : {};
  for (const [phone, session] of Object.entries(sessions)) {
    const updatedAt = Date.parse(String(session?.updatedAt || ''));
    if (!Number.isFinite(updatedAt) || now - updatedAt > STATE_TTL_MS) delete sessions[phone];
  }
  return { ...store, sessions };
}

function saveSession(session, env = process.env) {
  const store = pruneState(readState(env));
  const candidatePhone = normalizePhone(session.candidatePhone);
  if (!candidatePhone) throw Object.assign(new Error('SELLER_RECRUITMENT_PHONE_REQUIRED'), { code: 'SELLER_RECRUITMENT_PHONE_REQUIRED' });
  store.sessions[candidatePhone] = {
    ...session,
    candidatePhone,
    updatedAt: new Date().toISOString()
  };
  writeState(store, env);
  return store.sessions[candidatePhone];
}

function getSessionByCandidate(phone, env = process.env) {
  const store = pruneState(readState(env));
  writeState(store, env);
  return store.sessions[normalizePhone(phone)] || null;
}

function findSessionByPreview(code, env = process.env) {
  const target = String(code || '').trim().toUpperCase();
  if (!target) return null;
  const store = pruneState(readState(env));
  writeState(store, env);
  return Object.values(store.sessions).find(session =>
    String(session?.createPreviewCode || '').toUpperCase() === target ||
    String(session?.credentialPreviewCode || '').toUpperCase() === target
  ) || null;
}

function deleteSession(phone, env = process.env) {
  const store = pruneState(readState(env));
  delete store.sessions[normalizePhone(phone)];
  writeState(store, env);
}

function normalizePlatform(value) {
  const text = normalizeText(value);
  if (text.includes('elanhome')) return 'ELANHOME';
  if (text.includes('elanpet')) return 'ELANPET';
  if (text.includes('elancenter')) return 'ELANCENTER';
  if (text.includes('elankav')) return 'ELANKAV';
  return 'ELANVISUAL';
}

function safeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/g, '').trim();
}

function detectRecruitmentStart(message, platformHint = '') {
  const raw = String(message || '').trim();
  const normalized = normalizeText(raw);
  if (!/\bventas\b/.test(normalized) && !/\bcomo vendedor(?:a)?\b/.test(normalized)) return null;
  if (!/\b(escribile|escribele|escrivele|contacta|contactalo|contactala|mandale|mensajea)\b/.test(normalized)) return null;
  if (!/\b(agregalo|agregala|agregalo|agragalo|agragala|registralo|registrala|incorporalo|incorporala|sumalo|sumala)\b/.test(normalized)) return null;

  const phoneMatch = raw.match(/(?:\+?505[\s-]*)?[2-9]\d(?:[\s-]*\d){6,7}/);
  const phone = normalizePhone(phoneMatch?.[0] || '');
  if (!phone) return null;

  const beforePhone = raw.slice(0, phoneMatch.index).trim();
  const nameMatch = beforePhone.match(/\b(?:escribile|escribele|escrivele|contacta|contactalo|contactala|mandale|mensajea)\s+(?:a\s+)?(.+?)\s+(?:(?:al|a|por)\s*(?:whatsapp\s*)?|(?:con\s+(?:el\s+)?(?:numero|número|whatsapp)\s*(?:es)?\s*)|(?:su\s+(?:numero|número|whatsapp)\s*(?:es)?\s*))$/i);
  let name = safeName(nameMatch?.[1] || '');
  name = name.replace(/^elan[\s,:-]+/i, '').trim();
  if (!name || name.length > 160) return null;

  return {
    candidateName: name,
    candidatePhone: phone,
    platform: normalizePlatform(`${platformHint} ${raw}`),
    department: 'VENTAS'
  };
}

function parseEmail(message) {
  return String(message || '').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase() || '';
}

function parseCandidateName(message) {
  const raw = String(message || '').trim();
  const patterns = [
    /(?:mi\s+nombre\s+(?:completo\s+)?es|nombre\s*[:=])\s*(.+?)(?=\s+(?:y\s+)?(?:mi\s+)?(?:correo|email)\b|[,;\n]|$)/i,
    /(?:soy)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,100})(?=\s+(?:y\s+)?(?:mi\s+)?(?:correo|email)\b|[,;\n]|$)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = safeName(match?.[1] || '');
    if (value) return value;
  }
  return '';
}

function unwrapSellerList(payload) {
  const data = payload?.data ?? payload?.result?.data ?? payload?.result ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.sellers)) return data.sellers;
  return [];
}

function exactSellerByPhone(payload, phone) {
  const target = normalizePhone(phone);
  return unwrapSellerList(payload).find(seller => {
    const sellerPhone = normalizePhone(seller?.whatsapp || seller?.phone || '');
    return sellerPhone && sellerPhone === target;
  }) || null;
}

function extractPreviewCode(text) {
  return String(text || '').match(/\b(SELLER-[A-Z0-9-]+)\b/i)?.[1]?.toUpperCase() || '';
}

function actorForOwner(ownerPhone) {
  return {
    role: 'owner',
    actorId: 'owner',
    authority: 'owner_identity',
    phone: normalizePhone(ownerPhone),
    canonicalPhone: normalizePhone(ownerPhone),
    platforms: ['*'],
    scopes: ['*']
  };
}

async function createSellerPreview(session, env = process.env, dependencies = {}) {
  const execute = dependencies.executeOwnerUnifiedCommand || commandService.executeOwnerUnifiedCommand;
  return execute({
    command: {
      sellerPreview: true,
      action: 'create',
      data: {
        displayName: session.data.displayName,
        whatsapp: `+${session.candidatePhone}`,
        phone: `+${session.candidatePhone}`,
        email: session.data.email
      },
      tool: 'previsualizar_crear_vendedor'
    },
    actor: actorForOwner(session.ownerPhone),
    channel: 'whatsapp',
    env
  });
}

async function createCredentialPreview(session, env = process.env, dependencies = {}) {
  const execute = dependencies.executeOwnerUnifiedCommand || commandService.executeOwnerUnifiedCommand;
  return execute({
    command: {
      sellerPreview: true,
      action: 'credential',
      query: session.candidatePhone,
      tool: 'previsualizar_credencial_vendedor'
    },
    actor: actorForOwner(session.ownerPhone),
    channel: 'whatsapp',
    env
  });
}

function buildCandidateInvitation(session) {
  return [
    `Hola, ${session.candidateNameHint}. Soy ELAN.`,
    '',
    'Erick Cano me pidió iniciar tu incorporación al equipo de Ventas de ELANVISUAL.',
    'Para preparar tu registro, respondeme con tu nombre completo y tu correo electrónico.',
    'Tu WhatsApp será este mismo número.',
    '',
    'Esto todavía no crea tu usuario ni una contraseña. Erick revisará los datos antes de aprobar el registro.'
  ].join('\n');
}

async function startRecruitment({ message, phone, externalUserId, platform, env = process.env }, dependencies = {}) {
  if (!isOwnerIdentity({ phone, externalUserId }, env)) return null;
  const parsed = detectRecruitmentStart(message, platform);
  if (!parsed) return null;

  const listSellers = dependencies.listOwnerSellers || connect.listOwnerSellers;
  const sellersPayload = await listSellers('', env);
  const existing = exactSellerByPhone(sellersPayload, parsed.candidatePhone);
  if (existing) {
    const existingName = String(existing.displayName || existing.display_name || existing.name || existing.id || 'vendedor').trim();
    return {
      handled: true,
      reply: `⚠️ No inicié el alta. Ya existe un vendedor en CONNECT con el WhatsApp +${parsed.candidatePhone}: ${existingName}. Primero hay que resolver ese registro para evitar duplicados.`
    };
  }

  const current = getSessionByCandidate(parsed.candidatePhone, env);
  if (current && !['completed', 'cancelled'].includes(current.status)) {
    return {
      handled: true,
      reply: `ℹ️ Ya hay un proceso de incorporación activo para ${current.candidateNameHint} (+${current.candidatePhone}). No envié un mensaje duplicado.`
    };
  }

  const ownerPhone = normalizePhone(phone) || normalizePhone(externalUserId) || ownerPhones(env)[0];
  const session = {
    ownerPhone,
    candidatePhone: parsed.candidatePhone,
    candidateNameHint: parsed.candidateName,
    platform: parsed.platform,
    department: parsed.department,
    status: 'awaiting_candidate_data',
    data: {
      displayName: parsed.candidateName,
      email: ''
    },
    createdAt: new Date().toISOString(),
    createPreviewCode: '',
    credentialPreviewCode: ''
  };

  const delivery = dependencies.delivery || createWahaDeliveryAdapter({ env });
  await delivery.sendText({ phone: parsed.candidatePhone, text: buildCandidateInvitation(session) });
  saveSession(session, env);

  return {
    handled: true,
    reply: [
      `✅ Le escribí a ${parsed.candidateName} al +${parsed.candidatePhone}.`,
      'Le solicité nombre completo y correo para incorporarlo a Ventas.',
      'Cuando responda, ELAN te enviará el PREVIO para aprobación.',
      'No se creó ningún vendedor ni credencial.'
    ].join('\n')
  };
}

async function processCandidateReply({ message, phone, externalUserId, env = process.env }, dependencies = {}) {
  const candidatePhone = normalizePhone(phone) || normalizePhone(externalUserId);
  if (!candidatePhone || isOwnerIdentity({ phone: candidatePhone }, env)) return null;
  const session = getSessionByCandidate(candidatePhone, env);
  if (!session || session.status !== 'awaiting_candidate_data') return null;

  const name = parseCandidateName(message);
  const email = parseEmail(message);
  if (name) session.data.displayName = name;
  if (email) session.data.email = email;

  if (!session.data.email) {
    saveSession(session, env);
    return {
      handled: true,
      reply: `Gracias${session.data.displayName ? `, ${session.data.displayName}` : ''}. Me falta únicamente tu correo electrónico para preparar el registro. No se ha creado ningún usuario todavía.`
    };
  }

  const preview = await createSellerPreview(session, env, dependencies);
  const previewCode = extractPreviewCode(preview?.reply);
  if (!previewCode) {
    saveSession(session, env);
    return {
      handled: true,
      reply: 'Recibí tus datos, pero no pude preparar la revisión del registro. No se creó ningún usuario ni contraseña.'
    };
  }

  session.createPreviewCode = previewCode;
  session.status = 'awaiting_owner_create_confirmation';
  saveSession(session, env);

  const delivery = dependencies.delivery || createWahaDeliveryAdapter({ env });
  await delivery.sendText({
    phone: session.ownerPhone,
    text: [
      `📥 ${session.data.displayName} respondió la solicitud de incorporación a Ventas.`,
      '',
      preview.reply,
      '',
      `Destino después de aprobar: ${session.platform} / ${session.department}.`,
      'La credencial se preparará en un SEGUNDO PREVIO; no se generará contraseña con esta primera confirmación.'
    ].join('\n')
  });

  return {
    handled: true,
    reply: '✅ Gracias. Ya envié tus datos a Erick para revisión. No se ha creado todavía tu usuario ni una contraseña.'
  };
}

function confirmationCode(message) {
  return String(message || '').trim().match(/^CONFIRMAR\s+(SELLER-[A-Z0-9-]+)\s*$/i)?.[1]?.toUpperCase() || '';
}

async function afterOwnerMessage({ message, phone, externalUserId, env = process.env }, result, dependencies = {}) {
  if (!isOwnerIdentity({ phone, externalUserId }, env)) return result;
  const code = confirmationCode(message);
  if (!code) return result;
  const session = findSessionByPreview(code, env);
  if (!session) return result;

  const reply = String(result?.reply || '');
  if (code === session.createPreviewCode && session.status === 'awaiting_owner_create_confirmation') {
    if (!/Cambio confirmado y verificado en CONNECT/i.test(reply)) return result;

    const listSellers = dependencies.listOwnerSellers || connect.listOwnerSellers;
    const sellersPayload = await listSellers('', env);
    const seller = exactSellerByPhone(sellersPayload, session.candidatePhone);
    const sellerId = String(seller?.id || seller?.sellerId || '').trim();
    if (!sellerId) return result;

    const setPlatforms = dependencies.setOwnerSellerPlatforms || connect.setOwnerSellerPlatforms;
    await setPlatforms(sellerId, [{ platform: session.platform, status: 'active' }], env);

    const credential = await createCredentialPreview(session, env, dependencies);
    const credentialCode = extractPreviewCode(credential?.reply);
    if (!credentialCode) {
      session.status = 'seller_created_access_preview_failed';
      saveSession(session, env);
      return {
        ...result,
        reply: `${reply}\n\n⚠️ El vendedor quedó creado y asignado a Ventas, pero no pude preparar el PREVIO de acceso. No se generó ninguna contraseña.`
      };
    }

    session.credentialPreviewCode = credentialCode;
    session.status = 'awaiting_owner_credential_confirmation';
    session.sellerId = sellerId;
    saveSession(session, env);
    return {
      ...result,
      reply: [
        reply,
        '',
        `✅ ${session.data.displayName} quedó asignado a ${session.department} en ${session.platform}.`,
        '',
        '🔐 SEGUNDO PREVIO — ACCESO',
        credential.reply
      ].join('\n')
    };
  }

  if (code === session.credentialPreviewCode && session.status === 'awaiting_owner_credential_confirmation') {
    if (/Credencial temporal generada y enviada/i.test(reply)) {
      deleteSession(session.candidatePhone, env);
    }
    return result;
  }

  return result;
}

async function beforeMessage(args = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  const ownerStart = await startRecruitment({ ...args, env }, dependencies);
  if (ownerStart?.handled) return ownerStart;
  return processCandidateReply({ ...args, env }, dependencies);
}

module.exports = {
  DEFAULT_OWNER_PHONE,
  DEFAULT_STATE_FILE,
  STATE_TTL_MS,
  afterOwnerMessage,
  beforeMessage,
  buildCandidateInvitation,
  confirmationCode,
  detectRecruitmentStart,
  exactSellerByPhone,
  extractPreviewCode,
  isOwnerIdentity,
  normalizePhone,
  parseCandidateName,
  parseEmail,
  processCandidateReply,
  startRecruitment
};
