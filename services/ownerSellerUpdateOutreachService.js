'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');
const commandService = require('./elanUnifiedOwnerCommandService');
const connect = require('./ownerBusinessConnectClient');

const DEFAULT_OWNER_PHONE = '50588388940';
const DEFAULT_STATE_FILE = '/opt/elankav/state/seller-update-outreach-state.json';
const STATE_TTL_MS = 72 * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}
function normalizePhone(value) {
  if (String(value || '').toLowerCase().includes('@lid')) return '';
  const digits = String(value || '').split('@')[0].replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 8 ? `505${digits}` : digits;
}
function ownerPhones(env = process.env) {
  const values = String(env.ORCHESTRATOR_OWNER_PHONES || env.ORCHESTRATOR_OWNER_PHONE || '')
    .split(',').map(normalizePhone).filter(Boolean);
  return values.length ? values : [DEFAULT_OWNER_PHONE];
}
function isOwnerIdentity({ phone, externalUserId } = {}, env = process.env) {
  const candidate = normalizePhone(phone) || normalizePhone(externalUserId);
  return Boolean(candidate && ownerPhones(env).includes(candidate));
}
function stateFile(env = process.env) {
  return String(env.OWNER_SELLER_UPDATE_STATE_FILE || DEFAULT_STATE_FILE).trim();
}
function readStore(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(env), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { sessions: {} };
  } catch { return { sessions: {} }; }
}
function writeStore(store, env = process.env) {
  const file = stateFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function prune(store, now = Date.now()) {
  const sessions = store?.sessions && typeof store.sessions === 'object' ? store.sessions : {};
  for (const [key, session] of Object.entries(sessions)) {
    const updated = Date.parse(String(session?.updatedAt || ''));
    if (!Number.isFinite(updated) || now - updated > STATE_TTL_MS) delete sessions[key];
  }
  return { ...store, sessions };
}
function saveSession(session, env = process.env) {
  const store = prune(readStore(env));
  const key = normalizePhone(session.sellerPhone);
  if (!key) throw Object.assign(new Error('SELLER_UPDATE_PHONE_REQUIRED'), { code: 'SELLER_UPDATE_PHONE_REQUIRED' });
  store.sessions[key] = { ...session, sellerPhone: key, updatedAt: new Date().toISOString() };
  writeStore(store, env);
  return store.sessions[key];
}
function getSessionBySellerPhone(phone, env = process.env) {
  const store = prune(readStore(env));
  writeStore(store, env);
  return store.sessions[normalizePhone(phone)] || null;
}
function findSessionByPreview(code, env = process.env) {
  const target = String(code || '').trim().toUpperCase();
  if (!target) return null;
  const store = prune(readStore(env));
  writeStore(store, env);
  return Object.values(store.sessions).find(session =>
    String(session?.updatePreviewCode || '').toUpperCase() === target ||
    String(session?.credentialPreviewCode || '').toUpperCase() === target
  ) || null;
}
function deleteSession(phone, env = process.env) {
  const store = prune(readStore(env));
  delete store.sessions[normalizePhone(phone)];
  writeStore(store, env);
}
function stripHonorifics(value) {
  return String(value || '').trim()
    .replace(/^(?:arq(?:uitecto|uitecta)?|ing(?:eniero|eniera)?|lic(?:enciado|enciada)?|dr(?:a)?|sr(?:a)?|srita)\.?\s+/i, '')
    .trim();
}
function normalizeName(value) {
  return normalizeText(stripHonorifics(value)).replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}
function sellerName(seller = {}) {
  return String(seller.displayName || seller.display_name || seller.name || seller.legalName || seller.legal_name || '').trim();
}
function sellerPhone(seller = {}) {
  return normalizePhone(seller.whatsapp || seller.phone || '');
}
function unwrapSellerList(payload) {
  const data = payload?.data ?? payload?.result?.data ?? payload?.result ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.sellers)) return data.sellers;
  return [];
}
function findSellerMatches(sellers, query) {
  const needle = normalizeName(query);
  if (!needle) return [];
  const exact = sellers.filter(seller => normalizeName(sellerName(seller)) === needle);
  if (exact.length) return exact;
  return sellers.filter(seller => normalizeName(sellerName(seller)).includes(needle) || needle.includes(normalizeName(sellerName(seller))));
}
function detectUpdateOutreachStart(message) {
  const raw = String(message || '').trim();
  const normalized = normalizeText(raw);
  if (!/\b(escribile|escribele|escrivele|contacta|contactalo|contactala|mandale|mensajea)\b/.test(normalized)) return null;
  if (!/\b(actualiza|actualizar|actualizale|actualice|actualicele|renova|renovar|verifica|verificar)\b/.test(normalized)) return null;
  if (!/\b(informacion|datos|perfil|registro)\b/.test(normalized)) return null;
  const match = raw.match(/\b(?:escribile|escribele|escrivele|contacta|contactalo|contactala|mandale|mensajea)\s+(?:a\s+)?(.+?)\s+(?:y\s+)?(?:actualiza|actualizar|actualizale|actualice|actualicele|renova|renovar|verifica|verificar)\b/i);
  const name = String(match?.[1] || '').trim().replace(/[,:;]+$/g, '').trim();
  return name ? { query: name } : null;
}
function parseEmail(message) {
  return String(message || '').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase() || '';
}
function parseExplicitPhone(message) {
  const match = String(message || '').match(/(?:whatsapp|wasap|telefono|teléfono|celular|numero|número)\s*(?:nuevo|actual)?\s*(?:es|:|=)?\s*(\+?[\d\s-]{8,})/i);
  return match ? normalizePhone(match[1]) : '';
}
function parseCandidateName(message) {
  const raw = String(message || '').trim();
  const match = raw.match(/(?:mi\s+nombre\s+(?:completo\s+)?es|nombre\s*[:=])\s*(.+?)(?=\s+(?:y\s+)?(?:mi\s+)?(?:correo|email|whatsapp|telefono|teléfono|zona)\b|[,;\n]|$)/i);
  return String(match?.[1] || '').trim().replace(/[.!]+$/g, '').trim();
}
function parseZone(message) {
  return String(message || '').match(/(?:zona|territorio)\s*(?:es|:|=)?\s*([^,;\n]+)/i)?.[1]?.trim() || '';
}
function extractUpdates(message, current = {}) {
  const updates = {};
  const name = parseCandidateName(message);
  const email = parseEmail(message);
  const phone = parseExplicitPhone(message);
  const zone = parseZone(message);
  if (name && normalizeName(name) !== normalizeName(sellerName(current))) updates.displayName = name;
  if (email && normalizeText(email) !== normalizeText(current.email)) updates.email = email;
  if (phone && phone !== sellerPhone(current)) {
    updates.whatsapp = `+${phone}`;
    updates.phone = `+${phone}`;
  }
  if (zone && normalizeText(zone) !== normalizeText(current.zone)) updates.zone = zone;
  return updates;
}
function extractPreviewCode(text) {
  return String(text || '').match(/\b(SELLER-[A-Z0-9-]+)\b/i)?.[1]?.toUpperCase() || '';
}
function confirmationCode(message) {
  return String(message || '').trim().match(/^CONFIRMAR\s+(SELLER-[A-Z0-9-]+)\s*$/i)?.[1]?.toUpperCase() || '';
}
function actorForOwner(ownerPhone) {
  return { role: 'owner', actorId: 'owner', authority: 'owner_identity', phone: normalizePhone(ownerPhone), canonicalPhone: normalizePhone(ownerPhone), platforms: ['*'], scopes: ['*'] };
}
function buildUpdateRequest(session) {
  return [
    `Hola, ${sellerName(session.currentSeller) || 'te saluda ELAN'}. Soy ELAN.`,
    '',
    'Estamos actualizando tu información de vendedor en ELANVISUAL.',
    'Por favor confirmame o actualizame estos datos:',
    '- nombre completo',
    '- correo electrónico',
    '- WhatsApp/teléfono si cambió',
    '- zona o territorio si aplica',
    '',
    'Podés responder todo en un solo mensaje. Erick revisará cualquier cambio antes de guardarlo.'
  ].join('\n');
}
async function createEditPreview(session, updates, env = process.env, dependencies = {}) {
  const execute = dependencies.executeOwnerUnifiedCommand || commandService.executeOwnerUnifiedCommand;
  return execute({
    command: { sellerPreview: true, action: 'edit', query: session.sellerPhone, data: updates, tool: 'previsualizar_editar_vendedor' },
    actor: actorForOwner(session.ownerPhone), channel: 'whatsapp', env
  });
}
async function createCredentialPreview(session, env = process.env, dependencies = {}) {
  const execute = dependencies.executeOwnerUnifiedCommand || commandService.executeOwnerUnifiedCommand;
  return execute({
    command: { sellerPreview: true, action: 'credential', query: session.sellerPhone, tool: 'previsualizar_credencial_vendedor' },
    actor: actorForOwner(session.ownerPhone), channel: 'whatsapp', env
  });
}
async function startUpdateOutreach({ message, phone, externalUserId, env = process.env, ownerVerified = false }, dependencies = {}) {
  if (!ownerVerified && !isOwnerIdentity({ phone, externalUserId }, env)) return null;
  const detected = detectUpdateOutreachStart(message);
  if (!detected) return null;
  const listSellers = dependencies.listOwnerSellers || connect.listOwnerSellers;
  const payload = await listSellers('', env);
  const matches = findSellerMatches(unwrapSellerList(payload), detected.query);
  if (!matches.length) return { handled: true, reply: `No encontré un vendedor que coincida con “${detected.query}” en CONNECT. No envié ningún mensaje.` };
  if (matches.length > 1) {
    return {
      handled: true,
      reply: ['Encontré varias coincidencias. No envié ningún mensaje:', ...matches.slice(0, 10).map((seller, index) => `${index + 1}. ${sellerName(seller)} — WhatsApp: ${seller.whatsapp || seller.phone || '—'}`), '', 'Indicame cuál vendedor querés actualizar.'].join('\n')
    };
  }
  const seller = matches[0];
  const targetPhone = sellerPhone(seller);
  if (!targetPhone) return { handled: true, reply: `Encontré a ${sellerName(seller)}, pero no tiene WhatsApp/teléfono registrado en CONNECT. No envié ningún mensaje.` };
  const current = getSessionBySellerPhone(targetPhone, env);
  if (current && !['completed', 'cancelled'].includes(current.status)) {
    return { handled: true, reply: `Ya hay una actualización en curso para ${sellerName(seller)}. No envié un mensaje duplicado.` };
  }
  const ownerPhone = normalizePhone(phone) || normalizePhone(externalUserId) || ownerPhones(env)[0];
  const session = {
    ownerPhone,
    sellerPhone: targetPhone,
    sellerId: String(seller.id || seller.sellerId || ''),
    currentSeller: seller,
    status: 'awaiting_seller_data',
    updates: {},
    updatePreviewCode: '',
    credentialPreviewCode: '',
    createdAt: new Date().toISOString()
  };
  const delivery = dependencies.delivery || createWahaDeliveryAdapter({ env });
  await delivery.sendText({ phone: targetPhone, text: buildUpdateRequest(session) });
  saveSession(session, env);
  return {
    handled: true,
    reply: [`✅ Le escribí a ${sellerName(seller)} usando su WhatsApp oficial de CONNECT.`, 'Le solicité confirmar/actualizar sus datos.', 'Cuando responda, te enviaré un PREVIO con los cambios.', 'No se modificó ningún registro ni se generó ninguna credencial.'].join('\n')
  };
}
async function processSellerReply({ message, phone, externalUserId, env = process.env }, dependencies = {}) {
  const incomingPhone = normalizePhone(phone) || normalizePhone(externalUserId);
  if (!incomingPhone || isOwnerIdentity({ phone: incomingPhone }, env)) return null;
  const session = getSessionBySellerPhone(incomingPhone, env);
  if (!session || session.status !== 'awaiting_seller_data') return null;
  const updates = extractUpdates(message, session.currentSeller);
  if (!Object.keys(updates).length) {
    return { handled: true, reply: 'Gracias. No detecté ningún dato diferente al registro actual. Si necesitás cambiar algo, enviame nombre, correo, WhatsApp/teléfono o zona en un solo mensaje.' };
  }
  session.updates = updates;
  const preview = await createEditPreview(session, updates, env, dependencies);
  const code = extractPreviewCode(preview?.reply);
  if (!code) {
    saveSession(session, env);
    return { handled: true, reply: 'Recibí los cambios, pero no pude preparar la revisión. No se modificó ningún dato.' };
  }
  session.updatePreviewCode = code;
  session.status = 'awaiting_owner_update_confirmation';
  saveSession(session, env);
  const delivery = dependencies.delivery || createWahaDeliveryAdapter({ env });
  await delivery.sendText({
    phone: session.ownerPhone,
    text: [`📥 ${sellerName(session.currentSeller)} respondió la actualización.`, '', preview.reply, '', 'Después de aprobar los datos, ELAN preparará por separado el PREVIO de acceso. No se generará contraseña con esta confirmación.'].join('\n')
  });
  return { handled: true, reply: '✅ Gracias. Envié los cambios a Erick para revisión. Todavía no se modificó tu registro ni se generó ninguna contraseña.' };
}
async function afterOwnerMessage({ message, phone, externalUserId, env = process.env }, result, dependencies = {}) {
  const ownerVerified = String(result?.actorRole || '').toLowerCase() === 'owner';
  if (!ownerVerified && !isOwnerIdentity({ phone, externalUserId }, env)) return result;
  const code = confirmationCode(message);
  if (!code) return result;
  const session = findSessionByPreview(code, env);
  if (!session) return result;
  const reply = String(result?.reply || '');
  if (code === session.updatePreviewCode && session.status === 'awaiting_owner_update_confirmation') {
    if (!/Cambio confirmado y verificado en CONNECT/i.test(reply)) return result;
    const newPhone = normalizePhone(session.updates?.whatsapp || session.updates?.phone || '') || session.sellerPhone;
    session.sellerPhone = newPhone;
    const credential = await createCredentialPreview(session, env, dependencies);
    const credentialCode = extractPreviewCode(credential?.reply);
    if (!credentialCode) {
      session.status = 'update_completed_access_preview_failed';
      saveSession(session, env);
      return { ...result, reply: `${reply}\n\n⚠️ La información quedó actualizada, pero no pude preparar el PREVIO de acceso. No se generó ninguna contraseña.` };
    }
    session.credentialPreviewCode = credentialCode;
    session.status = 'awaiting_owner_credential_confirmation';
    saveSession(session, env);
    return { ...result, reply: [reply, '', '🔐 SEGUNDO PREVIO — ACCESO', credential.reply].join('\n') };
  }
  if (code === session.credentialPreviewCode && session.status === 'awaiting_owner_credential_confirmation') {
    if (/Credencial temporal generada y enviada/i.test(reply)) deleteSession(session.sellerPhone, env);
    return result;
  }
  return result;
}
async function beforeMessage(args = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  const start = await startUpdateOutreach({ ...args, env }, dependencies);
  if (start?.handled) return start;
  return processSellerReply({ ...args, env }, dependencies);
}

module.exports = {
  DEFAULT_STATE_FILE,
  STATE_TTL_MS,
  afterOwnerMessage,
  beforeMessage,
  buildUpdateRequest,
  detectUpdateOutreachStart,
  extractUpdates,
  findSellerMatches,
  isOwnerIdentity,
  normalizePhone,
  processSellerReply,
  startUpdateOutreach,
  stripHonorifics
};
