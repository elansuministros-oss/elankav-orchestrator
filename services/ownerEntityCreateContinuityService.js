'use strict';

const {
  readContext,
  updateContext
} = require('./ownerBusinessContextService');

const DEFAULT_PENDING_TTL_MS = 15 * 60 * 1000;
const SUPPORTED_TYPES = Object.freeze(['customer', 'provider', 'family']);

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function cleanText(value, maxLength = 240) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeActorKey(value) {
  return cleanText(value, 120).replace(/[^a-zA-Z0-9@._+-]/g, '');
}

function pendingTtlMs(env = process.env) {
  const configured = Number(env.OWNER_ENTITY_CREATE_PENDING_TTL_MS);
  return Number.isFinite(configured) && configured >= 60000
    ? configured
    : DEFAULT_PENDING_TTL_MS;
}

function entityTypeFromText(value) {
  const text = normalize(value);
  if (/\b(clientes?|cliente)\b/.test(text)) return 'customer';
  if (/\b(proveedor|proveedora|proveedores|provedor|provedores)\b/.test(text)) return 'provider';
  if (/\b(familia|familiar|familiares)\b/.test(text)) return 'family';
  return null;
}

function containsSellerType(value) {
  return /\b(vendedor|vendedora|vendedores|vendedoras)\b/.test(normalize(value));
}

function hasCreateIntent(value) {
  const text = normalize(value);
  return /\b(agrega|agregar|crea|crear|registra|registrar|registre|registrame|anade|anadir)\b/.test(text) ||
    /\bquiero\s+que\s+(?:registres?|registre|agregues?|agregue|crees?|cree)\b/.test(text);
}

function isCancelRequest(value) {
  const text = normalize(value);
  return /^(?:elan\s+)?(?:cancela|cancelar|cancelalo|cancelala|olvidalo|olvidala|dejalo|dejala|ya\s+no)$/i.test(text);
}

function extractPhone(value) {
  const raw = String(value || '');
  const matches = raw.match(/\+?\d[\d\s().-]{6,}\d/g) || [];
  for (const candidate of matches) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) continue;
    return candidate.trim().startsWith('+') ? `+${digits}` : digits;
  }
  return '';
}

function extractEmail(value) {
  return String(value || '').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || '';
}

function extractRelation(value) {
  const raw = String(value || '');
  const labeled = raw.match(/(?:relaci[oó]n|parentesco)\s*(?:es|:|=)?\s*([^,;\n]+)/i)?.[1];
  if (labeled) return cleanText(labeled, 80);
  return '';
}

function stripKnownNoise(value) {
  let text = cleanText(value, 300);
  const phone = extractPhone(text);
  const email = extractEmail(text);
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    const loose = digits.split('').join('[\\s().-]*');
    text = text.replace(new RegExp(`\\+?${loose}`, 'g'), ' ');
  }
  if (email) text = text.replace(email, ' ');

  text = text
    .replace(/^\s*(?:elan\s*[,;:\-]?\s*)?/i, '')
    .replace(/^\s*(?:(?:yo\s+)?quiero\s+que\s+)?(?:agrega|agregar|crea|crear|registra|registrar|registre|registrame|añade|anade|añadir|anadir)\s*/i, '')
    .replace(/^\s*(?:a|al|a\s+la)\s*[:=,-]?\s*/i, '')
    .replace(/^\s*(?:un|una)\s+(?:cliente|proveedor|proveedora|familiar|familia)\s*/i, '')
    .replace(/^\s*(?:cliente|proveedor|proveedora|familiar|familia)\s*[:=,-]?\s*/i, '')
    .replace(/\b(?:como|c[oó]mo)\s+(?:cliente|proveedor|proveedora|familiar|familia)\b/ig, ' ')
    .replace(/(?:relaci[oó]n|parentesco)\s*(?:es|:|=)?\s*[^,;\n]+/ig, ' ')
    .replace(/\b(?:whatsapp|wasap|tel[eé]fono|celular|correo|email)\s*(?:es|:|=)?/ig, ' ')
    .replace(/^[\s:;,.-]+|[\s:;,.-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleanText(text, 160);
}

function looksLikeStandaloneName(value) {
  const text = cleanText(value, 160);
  if (!text || /[?¿]/.test(text)) return false;
  const normalized = normalize(text);
  if (/\b(elan|precio|cotiza|cotizacion|busca|buscar|envia|enviar|activa|activar|desactiva|audita|quien|como|donde|cuando|porque|por\s+que|quiero|necesito|familia|familiar|cliente|proveedor|vendedor)\b/.test(normalized)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 7) return false;
  return words.every(word => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ.'-]{2,}$/.test(word));
}

function extractName(value, { allowStandalone = false } = {}) {
  const raw = cleanText(value, 300);
  if (!raw) return '';

  const explicit = raw.match(/(?:nombre\s*(?:es|:|=)|(?:registr(?:a|ar|e)|agrega|crea)\s+(?:a\s*)?[:=-]?)\s*([^+\d,;\n]+?)(?=\s+\+?\d|[,;]|$)/i)?.[1];
  if (explicit) {
    const candidate = stripKnownNoise(explicit);
    if (candidate && !entityTypeFromText(candidate)) return candidate;
  }

  if (hasCreateIntent(raw)) {
    const candidate = stripKnownNoise(raw);
    if (candidate && !entityTypeFromText(candidate) && looksLikeStandaloneName(candidate)) return candidate;
  }

  if (allowStandalone && looksLikeStandaloneName(raw)) return stripKnownNoise(raw);
  return '';
}

function commonDataFromMessage(value, options = {}) {
  const name = extractName(value, options);
  const phone = extractPhone(value);
  const email = extractEmail(value);
  const relation = extractRelation(value);
  return {
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(relation ? { relation } : {})
  };
}

function mergeCommonData(current = {}, incoming = {}) {
  const next = { ...(current && typeof current === 'object' ? current : {}) };
  for (const key of ['name', 'phone', 'email', 'relation']) {
    const value = cleanText(incoming?.[key], key === 'name' ? 160 : 120);
    if (value) next[key] = value;
  }
  return next;
}

function createTool(type) {
  return ({ customer: 'crear_cliente', provider: 'crear_proveedor', family: 'crear_familiar' })[type] || null;
}

function humanType(type) {
  return ({ customer: 'cliente', provider: 'proveedor', family: 'familiar' })[type] || 'registro';
}

function finalizeData(type, common = {}) {
  const name = cleanText(common.name, 160);
  const phone = cleanText(common.phone, 40);
  const email = cleanText(common.email, 160);
  const relation = cleanText(common.relation, 80);
  const contact = phone ? { phone, whatsapp: phone } : {};

  if (type === 'customer') {
    return {
      name,
      ...contact,
      ...(email ? { email } : {})
    };
  }

  if (type === 'provider') {
    return {
      tradeName: name,
      ...contact,
      ...(email ? { email } : {}),
      platforms: ['ELANVISUAL'],
      kinds: ['materials_products']
    };
  }

  return {
    displayName: name,
    ...(relation ? { relation } : {}),
    ...contact,
    ...(email ? { email } : {}),
    platforms: ['ELANVISUAL']
  };
}

function isExpired(pending, nowMs, env = process.env) {
  const stamp = Date.parse(pending?.updatedAt || pending?.startedAt || '');
  return !Number.isFinite(stamp) || nowMs - stamp > pendingTtlMs(env);
}

function pendingForActor(pending, actorKey) {
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) return null;
  const expected = normalizeActorKey(actorKey);
  const stored = normalizeActorKey(pending.actorKey);
  if (stored && expected && stored !== expected) return null;
  return pending;
}

async function clearPendingEntityCreate(env = process.env) {
  await updateContext({ pendingEntityCreate: null }, env);
}

async function savePending({ type = null, data = {}, actorKey = '', startedAt = null, now = new Date() } = {}, env = process.env) {
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const pending = {
    version: 1,
    type: SUPPORTED_TYPES.includes(type) ? type : null,
    data: mergeCommonData({}, data),
    actorKey: normalizeActorKey(actorKey),
    startedAt: startedAt || nowIso,
    updatedAt: nowIso
  };
  await updateContext({ pendingEntityCreate: pending }, env);
  return pending;
}

function promptForPending(pending) {
  if (!pending?.type) {
    const subject = pending?.data?.name ? ` a ${pending.data.name}` : '';
    return `Tengo los datos${subject}. ¿En qué categoría oficial querés registrarlo: cliente, proveedor o familiar?`;
  }
  if (!cleanText(pending?.data?.name, 160)) {
    return `Necesito el nombre del ${humanType(pending.type)}.`;
  }
  return null;
}

function readyCommand(pending) {
  if (!pending?.type || !SUPPORTED_TYPES.includes(pending.type)) return null;
  if (!cleanText(pending?.data?.name, 160)) return null;
  return {
    tool: createTool(pending.type),
    arguments: {
      data: finalizeData(pending.type, pending.data)
    }
  };
}

function isContinuationCandidate(message, pending) {
  if (!pending) return false;
  if (isCancelRequest(message)) return true;
  if (entityTypeFromText(message)) return true;
  if (hasCreateIntent(message)) return true;
  if (extractPhone(message) || extractEmail(message) || extractRelation(message)) return true;
  if (!pending?.data?.name && looksLikeStandaloneName(message)) return true;
  return false;
}

async function handleOwnerEntityCreateContinuity({
  message,
  actorKey = '',
  env = process.env,
  now = new Date()
} = {}) {
  const raw = cleanText(message, 500);
  if (!raw) return { handled: false };

  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const context = await readContext(env);
  let pending = pendingForActor(context.pendingEntityCreate, actorKey);

  if (pending && isExpired(pending, nowMs, env)) {
    await clearPendingEntityCreate(env);
    pending = null;
  }

  if (pending && isCancelRequest(raw)) {
    await clearPendingEntityCreate(env);
    return {
      handled: true,
      cancelled: true,
      reply: 'Registro pendiente cancelado. No hice cambios en CONNECT.'
    };
  }

  const explicitType = entityTypeFromText(raw);
  const sellerType = containsSellerType(raw);
  const createIntent = hasCreateIntent(raw);

  // Vendedor conserva su onboarding especializado; este flujo no lo suplanta.
  if (sellerType && createIntent) return { handled: false };

  if (!pending) {
    if (!createIntent) return { handled: false };

    const initialData = commonDataFromMessage(raw, { allowStandalone: false });

    // Una orden completa ya la resuelve el parser oficial existente.
    if (explicitType && initialData.name) return { handled: false };

    // No secuestrar órdenes genéricas sin ningún dato de persona/empresa.
    if (!explicitType && !initialData.name && !initialData.phone && !initialData.email) {
      return { handled: false };
    }

    pending = await savePending({
      type: explicitType,
      data: initialData,
      actorKey,
      now: nowDate
    }, env);

    const command = readyCommand(pending);
    if (command) return { handled: true, pending, command, clearOnSuccess: true };
    return { handled: true, pending, reply: promptForPending(pending) };
  }

  if (!isContinuationCandidate(raw, pending)) return { handled: false };

  const nextType = explicitType || pending.type || null;
  const allowStandalone = !pending?.data?.name;
  const incoming = commonDataFromMessage(raw, { allowStandalone });
  const nextData = mergeCommonData(pending.data, incoming);

  pending = await savePending({
    type: nextType,
    data: nextData,
    actorKey,
    startedAt: pending.startedAt,
    now: nowDate
  }, env);

  const command = readyCommand(pending);
  if (command) {
    return {
      handled: true,
      pending,
      command,
      clearOnSuccess: true
    };
  }

  return {
    handled: true,
    pending,
    reply: promptForPending(pending)
  };
}

module.exports = {
  DEFAULT_PENDING_TTL_MS,
  SUPPORTED_TYPES,
  cleanText,
  normalize,
  normalizeActorKey,
  entityTypeFromText,
  containsSellerType,
  hasCreateIntent,
  isCancelRequest,
  extractPhone,
  extractEmail,
  extractRelation,
  extractName,
  commonDataFromMessage,
  mergeCommonData,
  finalizeData,
  promptForPending,
  readyCommand,
  clearPendingEntityCreate,
  handleOwnerEntityCreateContinuity
};
