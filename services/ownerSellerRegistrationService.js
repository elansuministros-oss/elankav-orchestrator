'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { downloadWahaMedia } = require('./connectVoiceService');
const {
  createSeller,
  listSellers,
  provisionSellerAccess,
  setSellerPlatforms
} = require('./ownerSellerConnectClient');
const { extractSellerIdentityFromImage } = require('./ownerSellerIdentityExtractionService');
const { normalizeWhatsappE164 } = require('./phoneService');

const STATE_FILE = process.env.CRM_COMMAND_STATE_FILE || '/opt/elankav/state/crm-command-state.json';
const STATE_TTL_MS = Number(process.env.CRM_COMMAND_STATE_TTL_MS || 30 * 60 * 1000);
const SUPPORTED_PLATFORMS = Object.freeze(['ELANVISUAL', 'ELANHOME', 'ELANPET', 'ELANCENTER', 'ELANKAV']);

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

function isSellerAccessRequest(message) {
  const value = normalizeCommand(message);
  const asksAccess = /\b(genera|generar|generame|generame|habilita|habilitar|habilitame|provisiona|provisionar|crea|crear)\b.{0,40}\bacceso\b/.test(value)
    || /\bacceso\b.{0,40}\b(vendedor|vendedora)\b/.test(value);
  return asksAccess && /\b(vendedor|vendedora)\b/.test(value) && Boolean(parsePlatform(message));
}

function isSellerStart(message) {
  const value = normalizeCommand(message);
  if (/\b(no|sin)\s+(?:registra|registrar|agrega|agregar|crea|crear|carga|cargar|dar de alta)\b.{0,45}\b(vendedor|vendedora)\b/.test(value)) return false;
  if (isSellerAccessRequest(message)) return false;
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
  return new Set(['si', 'confirmo', 'guardar', 'proceder', 'confirmar', 'hazlo', 'hacelo', 'dale', 'correcto', 'si hazlo', 'si hacelo', 'procede']).has(value);
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

function parsePlatform(message) {
  const value = normalizeCommand(message);
  const aliases = [
    ['ELANVISUAL', ['elanvisual', 'elan visual', 'visual']],
    ['ELANHOME', ['elanhome', 'elan home']],
    ['ELANPET', ['elanpet', 'elan pet']],
    ['ELANCENTER', ['elancenter', 'elan center']],
    ['ELANKAV', ['elankav']]
  ];
  for (const [platform, names] of aliases) {
    if (names.some(name => value === name || value.includes(name))) return platform;
  }
  return '';
}

function parseNameCorrection(message) {
  const raw = normalize(message);
  const patterns = [
    /(?:cambia|cambiar|corrige|corregi|corrige el|pon|pone|deja|dejalo)(?:\s+el)?\s+nombre\s+(?:a|como|por)\s+(.+)$/i,
    /(?:el\s+)?nombre\s+correcto\s+(?:es|seria|sería)\s+(.+)$/i,
    /(?:dejalo|déjalo|ponelo|pónelo)\s+como\s+(.+)$/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return safeName(match[1].replace(/[.!?]+$/g, '').trim());
  }
  return '';
}

function parseSellerFields(message) {
  const whatsapp = normalizeWhatsappE164(message);
  return {
    displayName: parseName(message),
    whatsapp: whatsapp || '',
    email: parseEmail(message),
    zone: parseZone(message),
    teamId: parseTeam(message),
    platform: parsePlatform(message)
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
    identity: {
      imagesReceived: 0,
      frontReceived: false,
      backReceived: false,
      processedMediaKeys: [],
      printedName: '',
      naturalName: ''
    }
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
    `Plataforma asignada: ${data.platform || 'Pendiente'}`,
    data.zone ? `Zona: ${data.zone}` : '',
    data.teamId ? `Equipo/Supervisor: ${data.teamId}` : '',
    '',
    'La cédula se usó únicamente para apoyar la identificación del borrador; no guardaré la foto ni el número de documento en crm_sellers.',
    '',
    'Podés corregir cualquier dato antes de guardar. ¿Confirmás que registre este vendedor?'
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

function nameTokenKey(value) {
  return normalizeName(value).split(/\s+/).filter(Boolean).sort().join('|');
}

function parseAccessTargetName(message) {
  const labeled = parseName(message);
  if (labeled) return safeName(labeled);
  const raw = normalize(message);
  const patterns = [
    /(?:para\s+el\s+)?vendedor(?:a)?\s+existente\s+([^\n.]+)/i,
    /(?:del|de la)\s+vendedor(?:a)?\s+([^\n.]+)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return safeName(match[1].replace(/\s+(?:no\s+crear|sin\s+crear).*$/i, '').trim());
  }
  return '';
}

async function findExistingSeller(data) {
  const payload = await listSellers();
  const sellers = normalizeSellerRows(payload);
  const expectedPhone = digits(data.whatsapp);
  const expectedEmail = normalize(data.email).toLowerCase();
  const expectedName = normalizeName(data.displayName);
  const expectedNameTokens = nameTokenKey(data.displayName);
  return sellers.find(seller => {
    const phone = digits(seller.whatsapp || seller.phone);
    const email = normalize(seller.email).toLowerCase();
    const rawName = seller.display_name || seller.displayName || seller.legal_name || seller.legalName;
    const name = normalizeName(rawName);
    const nameTokens = nameTokenKey(rawName);
    return (expectedEmail && email === expectedEmail)
      || (expectedPhone && phone === expectedPhone)
      || (expectedName && name === expectedName)
      || (expectedNameTokens && nameTokens === expectedNameTokens);
  }) || null;
}

async function processExistingSellerAccessRequest(message) {
  const platform = parsePlatform(message);
  const email = parseEmail(message);
  const displayName = parseAccessTargetName(message);
  const seller = await findExistingSeller({ email, displayName });
  if (!seller) {
    const requested = email || displayName || 'el vendedor indicado';
    return {
      handled: true,
      completed: true,
      outputText: `No encontré un vendedor oficial que coincida con ${requested}. No creé ningún vendedor nuevo. Indicame el correo oficial o el código de vendedor para identificarlo.`
    };
  }

  const sellerId = normalize(seller.id);
  const sellerName = normalize(seller.display_name || seller.displayName || seller.legal_name || seller.legalName);
  const code = normalize(seller.seller_code || seller.sellerCode);
  try {
    const payload = await provisionSellerAccess(sellerId, platform);
    const access = payload?.data || payload || {};
    return {
      handled: true,
      completed: true,
      outputText: [
        '✅ Acceso generado reutilizando el vendedor existente.',
        '',
        `Nombre: ${sellerName}`,
        code ? `Código: ${code}` : '',
        `Plataforma: ${platform}`,
        access.loginUrl ? `Link: ${access.loginUrl}` : '',
        access.username ? `Usuario: ${access.username}` : '',
        access.password ? `Contraseña temporal: ${access.password}` : '',
        access.password ? 'La contraseña temporal se muestra una sola vez.' : '',
        '',
        'No se creó ningún vendedor duplicado.'
      ].filter(Boolean).join('\n')
    };
  } catch (error) {
    return {
      handled: true,
      completed: true,
      outputText: [
        '⚠️ Encontré y reutilicé el vendedor existente, pero no pude generar el acceso.',
        `Nombre: ${sellerName}`,
        code ? `Código: ${code}` : '',
        `Plataforma: ${platform}`,
        `Error: ${error?.message || 'No fue posible completar la operación.'}`,
        'No se creó ningún vendedor duplicado.'
      ].filter(Boolean).join('\n')
    };
  }
}

async function persistSeller(state) {
  const existing = await findExistingSeller(state.data);
  let seller = existing;
  if (!seller) {
    const payload = await createSeller({
      displayName: state.data.displayName,
      whatsapp: state.data.whatsapp,
      phone: state.data.whatsapp,
      ...(state.data.email ? { email: state.data.email } : {}),
      ...(state.data.zone ? { zone: state.data.zone } : {}),
      ...(state.data.teamId ? { teamId: state.data.teamId } : {}),
      status: 'active'
    });
    seller = payload?.data || payload;
  }

  const sellerId = normalize(seller?.id);
  if (!sellerId) throw Object.assign(new Error('SELLER_ID_MISSING_AFTER_CREATE'), { code: 'SELLER_ID_MISSING_AFTER_CREATE' });

  await setSellerPlatforms(sellerId, [{
    platform: state.data.platform,
    commissionEnabled: false,
    commissionRate: null,
    bonusEnabled: true,
    bonusRate: null,
    status: 'active'
  }]);

  let access = null;
  let accessError = null;
  try {
    const accessPayload = await provisionSellerAccess(sellerId, state.data.platform);
    access = accessPayload?.data || accessPayload;
  } catch (error) {
    accessError = {
      code: error?.code || 'SELLER_ACCESS_PROVISION_FAILED',
      message: error?.message || 'No se pudo generar el acceso de plataforma.'
    };
  }

  return {
    existing: Boolean(existing),
    seller,
    access,
    accessError
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
  if (!state.data.platform) {
    state.step = 'platform';
    return `¿A qué plataforma lo asignamos? Opciones actuales: ${SUPPORTED_PLATFORMS.join(', ')}.`;
  }
  state.step = 'confirm';
  return sellerSummary(state);
}

function mediaKey(metadata, media) {
  return normalize(metadata?.messageId) || normalize(media?.url);
}

async function processSellerImage(state, media, metadata = {}, dependencies = {}) {
  const key = mediaKey(metadata, media);
  state.identity.processedMediaKeys = Array.isArray(state.identity.processedMediaKeys)
    ? state.identity.processedMediaKeys
    : [];
  if (key && state.identity.processedMediaKeys.includes(key)) {
    return {
      done: false,
      text: state.identity.imagesReceived < 2
        ? 'Esa imagen ya la había procesado. Enviame la otra cara de la cédula.'
        : advanceAfterFields(state)
    };
  }

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

  const extracted = await extractImpl({ buffer: downloaded.buffer, mimeType });
  if (key) state.identity.processedMediaKeys.push(key);
  state.identity.imagesReceived = Number(state.identity.imagesReceived || 0) + 1;
  if (extracted.side === 'front') state.identity.frontReceived = true;
  if (extracted.side === 'back') state.identity.backReceived = true;
  if (extracted.printedName) state.identity.printedName = extracted.printedName;
  if (extracted.naturalName) state.identity.naturalName = extracted.naturalName;
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
    return { done: false, text: `Recibí la primera imagen de la identificación.${recognized} Enviame ahora la otra cara de la cédula.` };
  }

  return { done: false, text: advanceAfterFields(state) };
}

function nameOrderReply(state) {
  const printed = normalize(state.identity?.printedName);
  const natural = normalize(state.identity?.naturalName);
  if (printed && natural && normalizeName(printed) !== normalizeName(natural)) {
    state.data.displayName = natural;
    return `En la cédula aparece “${printed}”. Lo interpreté en orden natural como “${natural}” (nombres primero y apellidos después). Dejé el borrador con ese orden.\n\n${sellerSummary(state)}`;
  }
  return `El borrador tiene el nombre como “${state.data.displayName}”. Si querés cambiarlo, decime por ejemplo: “cambia el nombre a Yahosca Valentina Ramos Mena”.`;
}

async function processActiveSellerState(state, message, metadata, dependencies = {}) {
  if (isCancel(message)) return { done: true, cancelled: true, text: 'Registro de vendedor cancelado. No se realizó ningún cambio.' };

  const messageType = String(metadata?.messageType || '').toLowerCase();
  if (['image', 'document'].includes(messageType) && metadata?.media) {
    return processSellerImage(state, metadata.media, metadata, dependencies);
  }

  const explicitNameCorrection = parseNameCorrection(message);
  if (explicitNameCorrection) state.data.displayName = explicitNameCorrection;

  const fields = parseSellerFields(message);
  mergeFields(state.data, fields);

  if (state.step === 'identity' || state.step === 'name') {
    if (!state.data.displayName) {
      const raw = normalize(message);
      const isPlaceholder = /^\[archivo recibido:/i.test(raw);
      if (!isPlaceholder && !fields.whatsapp && !fields.email && !fields.platform && raw.length >= 2 && raw.length <= 160) {
        state.data.displayName = safeName(raw);
      }
    }
    return { done: false, text: advanceAfterFields(state) };
  }

  if (state.step === 'whatsapp') {
    if (!state.data.whatsapp) return { done: false, text: 'El número no es válido. Enviámelo, por ejemplo, como 8888-8888 o +505 8888-8888.' };
    return { done: false, text: advanceAfterFields(state) };
  }

  if (state.step === 'platform') {
    if (!state.data.platform) return { done: false, text: `No reconocí la plataforma. Indicame una de estas: ${SUPPORTED_PLATFORMS.join(', ')}.` };
    return { done: false, text: advanceAfterFields(state) };
  }

  if (state.step === 'confirm') {
    if (explicitNameCorrection || Object.values(fields).some(Boolean)) {
      state.step = state.data.displayName && state.data.whatsapp && state.data.platform
        ? 'confirm'
        : (!state.data.displayName ? 'name' : !state.data.whatsapp ? 'whatsapp' : 'platform');
      return { done: false, text: advanceAfterFields(state) };
    }

    const normalized = normalizeCommand(message);
    if (/\b(nombre|apellido|apellidos|orden)\b/.test(normalized) && !isConfirm(message)) {
      return { done: false, text: nameOrderReply(state) };
    }

    if (!isConfirm(message)) {
      return { done: false, text: 'Podés corregir nombre, WhatsApp, correo o plataforma antes de guardar. Cuando esté correcto respondé “Sí”; para salir respondé “Cancelar”.' };
    }

    const saved = await persistSeller(state);
    const seller = saved.seller || {};
    const code = seller.seller_code || seller.sellerCode || '';
    const access = saved.access || {};
    return {
      done: true,
      text: [
        saved.existing ? '✅ Ese vendedor ya estaba registrado; reutilicé el registro oficial.' : '✅ Vendedor registrado en CONNECT.',
        '',
        `Nombre: ${state.data.displayName}`,
        `WhatsApp: ${state.data.whatsapp}`,
        `Plataforma: ${state.data.platform}`,
        code ? `Código: ${code}` : '',
        '',
        access.loginUrl ? '🔐 Acceso de usuario generado:' : '',
        access.loginUrl ? `Link: ${access.loginUrl}` : '',
        access.username ? `Usuario: ${access.username}` : '',
        access.password ? `Contraseña temporal: ${access.password}` : '',
        access.password ? 'La contraseña se muestra una sola vez; el vendedor debe cambiarla cuando implementemos el cambio obligatorio en la plataforma.' : '',
        saved.accessError ? `⚠️ El vendedor y su plataforma quedaron registrados, pero no pude generar el acceso: ${saved.accessError.message}` : '',
        '',
        'Autoridad: crm_sellers + crm_seller_platforms.'
      ].filter(Boolean).join('\n')
    };
  }

  return { done: false, text: advanceAfterFields(state) };
}

async function processSellerRegistrationConversation({ message, externalUserId, phone, metadata = {}, dependencies = {} }) {
  const key = ownerKey({ externalUserId, phone });
  const states = readStates();
  let state = states[key];

  if (state && expired(state)) {
    delete states[key];
    writeStates(states);
    state = null;
  }

  if (isSellerAccessRequest(message)) {
    if (state?.type === 'seller') {
      delete states[key];
      writeStates(states);
    }
    return processExistingSellerAccessRequest(message);
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

  return { handled: true, completed: result.done === true, outputText: result.text };
}

module.exports = {
  STATE_FILE,
  STATE_TTL_MS,
  SUPPORTED_PLATFORMS,
  isSellerAccessRequest,
  isSellerStart,
  parseSellerFields,
  parseNameCorrection,
  processSellerRegistrationConversation,
  sellerSummary
};