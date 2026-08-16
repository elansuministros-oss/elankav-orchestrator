'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { downloadWahaMedia } = require('./connectVoiceService');
const { createSeller, listSellers } = require('./ownerSellerConnectClient');
const { extractSellerIdentityFromImage } = require('./ownerSellerIdentityExtractionService');
const { normalizeWhatsappE164 } = require('./phoneService');

const STATE_FILE = process.env.CRM_COMMAND_STATE_FILE || '/opt/elankav/state/crm-command-state.json';
const STATE_TTL_MS = Number(process.env.CRM_COMMAND_STATE_TTL_MS || 30 * 60 * 1000);

const normalize = value => String(value || '').trim();
const normalizeCommand = value => normalize(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ');

function ownerKey({ externalUserId, phone }) {
  return normalize(externalUserId) || normalize(phone) || 'owner';
}

function readStates() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; }
  catch { return {}; }
}

function writeStates(states) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(states, null, 2), { mode: 0o600 });
  fs.renameSync(temp, STATE_FILE);
}

function touch(state) {
  return { ...state, updatedAt: new Date().toISOString() };
}

function expired(state, now = Date.now()) {
  const updated = Date.parse(String(state?.updatedAt || ''));
  return !Number.isFinite(updated) || now - updated > STATE_TTL_MS;
}

function isSellerStart(message) {
  const value = normalizeCommand(message);
  return /\b(registra|registrar|agrega|agregar|crea|crear|carga|cargar|dar de alta|alta)\b.{0,35}\b(vendedor|vendedora)\b/.test(value)
    || /\b(vendedor|vendedora)\b.{0,35}\b(registra|registrar|agrega|agregar|crea|crear|carga|cargar|dar de alta|alta)\b/.test(value)
    || /\bquiero (?:cargar|registrar|agregar|crear) (?:un |una )?vendedor(?:a)?\b/.test(value);
}

function isCancel(message) {
  const value = normalizeCommand(message).replace(/[.!?]+$/g, '');
  return /^(cancelar|cancela|cancelalo|cancelala|detener|deten|parar|deja eso|dejalo|olvida eso|olvidalo|no guardar)$/.test(value);
}

function isConfirm(message) {
  const value = normalizeCommand(message).replace(/[.!?]+$/g, '');
  return new Set(['si', 'sí', 'confirmo', 'guardar', 'proceder', 'confirmar', 'hazlo', 'hacelo', 'dale', 'correcto', 'si hazlo', 'si hacelo', 'procede']).has(value);
}

function parseEmail(message) {
  const match = normalize(message).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? match[0].toLowerCase() : '';
}

function extractLabeled(message, labels) {
  const lines = String(message || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const normalized = normalizeCommand(line);
    for (const label of labels) {
      const prefix = `${normalizeCommand(label)}:`;
      if (normalized.startsWith(prefix)) return line.slice(line.indexOf(':') + 1).trim();
    }
  }
  return '';
}

function parseName(message) {
  return extractLabeled(message, ['nombre', 'nombre completo', 'vendedor', 'vendedora']);
}

function parseZone(message) {
  return extractLabeled(message, ['zona', 'territorio']);
}

function parseTeam(message) {
  return extractLabeled(message, ['equipo', 'team', 'supervisor']);
}

function parseSellerFields(message) {
  const whatsapp = normalizeWhatsappE164(message);
  return {
    displayName: parseName(message),
    whatsapp: whatsapp || '',
    email: parseEmail(message),
    zone: parseZone(message),
    teamId: parseTeam(message)
  };
}

function mergeFields(data, fields) {
  for (const [key, value] of Object.entries(fields || {})) {
    if (normalize(value)) data[key] = normalize(value);
  }
  return data;
}

function safeName(value) {
  const name = normalize(value).replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 160 ? name : '';
}

function initialState() {
  return touch({
    type: 'seller',
    step: 'identity',
    data: { status: 'active' },
    identity: { imagesReceived: 0, frontReceived: false, backReceived: false }
  });
}

function sellerSummary(state) {
  const data = state.data || {};
  return [
    'Tengo listo el borrador del vendedor:',
    '',
    `Nombre: ${data.displayName || 'Pendiente'}`,
    `WhatsApp: ${data.whatsapp || 'Pendiente'}`,
    `Correo: ${data.email || 'No indicado'}`,
    data.zone ? `Zona: ${data.zone}` : '',
    data.teamId ? `Equipo/Supervisor: ${data.teamId}` : '',
    '',
    'La cédula se usó únicamente para apoyar la identificación del borrador; no guardaré la foto ni el número de documento en crm_sellers.',
    '',
    '¿Confirmás que registre este vendedor?'
  ].filter(Boolean).join('\n');
}

function normalizeSellerRows(payload) {
  if (Array.isArray(payload?.data?.sellers)) return payload.data.sellers;
  if (Array.isArray(payload?.sellers)) return payload.sellers;
  if (Array.isArray(payload)) return payload;
  return [];
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeName(value) {
  return normalizeCommand(value).replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

async function findExistingSeller(data) {
  const payload = await listSellers();
  const sellers = normalizeSellerRows(payload);
  const expectedPhone = digits(data.whatsapp);
  const expectedName = normalizeName(data.displayName);
  return sellers.find(seller => {
    const phone = digits(seller.whatsapp || seller.phone);
    const name = normalizeName(seller.display_name || seller.displayName || seller.legal_name || seller.legalName);
    return (expectedPhone && phone === expectedPhone) || (expectedName && name === expectedName);
  }) || null;
}

async function persistSeller(state) {
  const existing = await findExistingSeller(state.data);
  if (existing) {
    return {
      existing: true,
      seller: existing
    };
  }

  const payload = await createSeller({
    displayName: state.data.displayName,
    whatsapp: state.data.whatsapp,
    phone: state.data.whatsapp,
    ...(state.data.email ? { email: state.data.email } : {}),
    ...(state.data.zone ? { zone: state.data.zone } : {}),
    ...(state.data.teamId ? { teamId: state.data.teamId } : {}),
    status: 'active'
  });

  return {
    existing: false,
    seller: payload?.data || payload
  };
}

function advanceAfterFields(state) {
  if (!state.data.displayName) {
    state.step = 'name';
    return 'Me falta el nombre completo del vendedor. Escribímelo o enviame la foto frontal de la cédula.';
  }
  if (!state.data.whatsapp) {
    state.step = 'whatsapp';
    return 'Ya tengo el nombre. ¿Cuál es el WhatsApp del vendedor?';
  }
  state.step = 'confirm';
  return sellerSummary(state);
}

async function processSellerImage(state, media, dependencies = {}) {
  const downloadImpl = dependencies.downloadWahaMedia || downloadWahaMedia;
  const extractImpl = dependencies.extractSellerIdentityFromImage || extractSellerIdentityFromImage;
  if (!media?.url) {
    return { done: false, text: 'Recibí el adjunto, pero WAHA no entregó una URL de media válida. Podés reenviar la foto o escribirme el nombre.' };
  }

  const downloaded = await downloadImpl({ url: media.url });
  const mimeType = String(downloaded?.mimeType || media.mimeType || '').toLowerCase();
  if (!mimeType.startsWith('image/')) {
    return { done: false, text: 'Para leer la identificación necesito una foto (imagen). También podés escribirme el nombre del vendedor.' };
  }

  const extracted = await extractImpl({
    buffer: downloaded.buffer,
    mimeType
  });

  state.identity.imagesReceived = Number(state.identity.imagesReceived || 0) + 1;
  if (extracted.side === 'front') state.identity.frontReceived = true;
  if (extracted.side === 'back') state.identity.backReceived = true;
  if (!state.data.displayName && extracted.fullName && extracted.confidence >= 0.55) {
    state.data.displayName = safeName(extracted.fullName);
  }

  if (!extracted.documentDetected) {
    return {
      done: false,
      text: 'Recibí la imagen, pero no pude confirmar que sea un documento de identidad. Podés reenviarla más clara o escribirme el nombre completo.'
    };
  }

  if (state.identity.imagesReceived < 2) {
    const recognized = state.data.displayName ? ` Detecté el nombre: ${state.data.displayName}.` : '';
    return {
      done: false,
      text: `Recibí la primera imagen de la identificación.${recognized} Enviame ahora la otra cara de la cédula.`
    };
  }

  return { done: false, text: advanceAfterFields(state) };
}

async function processActiveSellerState(state, message, metadata, dependencies = {}) {
  if (isCancel(message)) return { done: true, cancelled: true, text: 'Registro de vendedor cancelado. No se realizó ningún cambio.' };

  const messageType = String(metadata?.messageType || '').toLowerCase();
  if (['image', 'document'].includes(messageType) && metadata?.media) {
    return processSellerImage(state, metadata.media, dependencies);
  }

  const fields = parseSellerFields(message);
  mergeFields(state.data, fields);

  if (state.step === 'identity' || state.step === 'name') {
    if (!state.data.displayName) {
      const raw = normalize(message);
      const isPlaceholder = /^\[archivo recibido:/i.test(raw);
      if (!isPlaceholder && !fields.whatsapp && !fields.email && raw.length >= 2 && raw.length <= 160) {
        state.data.displayName = safeName(raw);
      }
    }
    return { done: false, text: advanceAfterFields(state) };
  }

  if (state.step === 'whatsapp') {
    if (!state.data.whatsapp) {
      return { done: false, text: 'El número no es válido. Enviámelo, por ejemplo, como 8888-8888 o +505 8888-8888.' };
    }
    state.step = 'confirm';
    return { done: false, text: sellerSummary(state) };
  }

  if (state.step === 'confirm') {
    if (!isConfirm(message)) {
      if (Object.values(fields).some(Boolean)) {
        state.step = state.data.displayName && state.data.whatsapp ? 'confirm' : (!state.data.displayName ? 'name' : 'whatsapp');
        return { done: false, text: advanceAfterFields(state) };
      }
      return { done: false, text: 'Respondé “Sí” para registrar el vendedor o “Cancelar”. Si querés corregir un dato, enviámelo antes de confirmar.' };
    }

    const saved = await persistSeller(state);
    const seller = saved.seller || {};
    const code = seller.seller_code || seller.sellerCode || '';
    return {
      done: true,
      text: [
        saved.existing ? '✅ Ese vendedor ya estaba registrado; reutilicé el registro oficial.' : '✅ Vendedor registrado en CONNECT.',
        '',
        `Nombre: ${state.data.displayName}`,
        `WhatsApp: ${state.data.whatsapp}`,
        code ? `Código: ${code}` : '',
        '',
        'Autoridad: crm_sellers.',
        'Las plataformas y comisiones se pueden configurar después sin crear otro vendedor.'
      ].filter(Boolean).join('\n')
    };
  }

  return { done: false, text: advanceAfterFields(state) };
}

async function processSellerRegistrationConversation({
  message,
  externalUserId,
  phone,
  metadata = {},
  dependencies = {}
}) {
  const key = ownerKey({ externalUserId, phone });
  const states = readStates();
  let state = states[key];

  if (state && expired(state)) {
    delete states[key];
    writeStates(states);
    state = null;
  }

  if (state && state.type !== 'seller') return { handled: false };

  if (!state) {
    if (!isSellerStart(message)) return { handled: false };
    state = initialState();
    states[key] = state;
    writeStates(states);
    return {
      handled: true,
      completed: false,
      outputText: 'Perfecto. Inicié el registro del vendedor. Enviame la cédula (frente y reverso) o escribime el nombre completo. No guardaré las fotos ni el número de documento en el registro oficial.'
    };
  }

  const result = await processActiveSellerState(state, message, metadata, dependencies);
  if (result.done) delete states[key];
  else states[key] = touch(state);
  writeStates(states);

  return {
    handled: true,
    completed: result.done === true,
    outputText: result.text
  };
}

module.exports = {
  STATE_FILE,
  STATE_TTL_MS,
  isSellerStart,
  parseSellerFields,
  processSellerRegistrationConversation,
  sellerSummary
};
