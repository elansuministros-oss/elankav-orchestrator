'use strict';

const {
  readContext,
  updateContext
} = require('./ownerBusinessContextService');

const DEFAULT_PENDING_TTL_MS = 15 * 60 * 1000;
const SUPPORTED_TYPES = Object.freeze(['customer', 'provider', 'family']);
const PROVIDER_STRING_FIELDS = Object.freeze([
  'name', 'phone', 'whatsapp', 'email', 'legalName', 'taxId', 'contactName',
  'city', 'country', 'address', 'website', 'currency', 'notes'
]);
const PROVIDER_ARRAY_FIELDS = Object.freeze(['platforms', 'kinds', 'categories', 'specialties']);

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

function labeledValue(value, labels = []) {
  const lines = String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const normalizedLine = normalize(line);
    for (const label of labels) {
      const prefix = `${normalize(label)}:`;
      if (normalizedLine.startsWith(prefix)) {
        return line.slice(line.indexOf(':') + 1).trim();
      }
    }
  }
  return '';
}

function splitList(value) {
  return [...new Set(String(value || '')
    .split(/[;,]/)
    .map(item => cleanText(item, 160))
    .filter(Boolean))];
}

function normalizeProviderPlatforms(value) {
  const allowed = new Set(['ELANVISUAL', 'ELANHOME', 'ELANPET', 'ELANCENTER', 'ELANKAV', 'OTRA']);
  return splitList(value)
    .map(item => item.toUpperCase().replace(/[\s_-]+/g, ''))
    .map(item => item === 'ELANVISUAL' ? 'ELANVISUAL'
      : item === 'ELANHOME' ? 'ELANHOME'
        : item === 'ELANPET' ? 'ELANPET'
          : item === 'ELANCENTER' ? 'ELANCENTER'
            : item === 'ELANKAV' ? 'ELANKAV'
              : item === 'OTRA' || item === 'OTRO' ? 'OTRA' : '')
    .filter(item => allowed.has(item));
}

function normalizeProviderKinds(value) {
  const text = normalize(value);
  const kinds = [];
  if (/\b(material|materiales|producto|productos|insumo|insumos)\b/.test(text)) kinds.push('materials_products');
  if (/\b(servicio|servicios|subcontratacion|subcontrataciones|subcontrato|subcontratos)\b/.test(text)) kinds.push('services_subcontracting');
  return [...new Set(kinds)];
}

function providerDataFromMessage(value) {
  const tradeName = labeledValue(value, ['empresa', 'nombre comercial', 'empresa / nombre comercial']);
  const contactName = labeledValue(value, ['contacto', 'persona de contacto', 'atencion', 'atención']);
  const legalName = labeledValue(value, ['razon social', 'razón social']);
  const taxId = labeledValue(value, ['ruc', 'tax id', 'identificacion fiscal', 'identificación fiscal']);
  const whatsappRaw = labeledValue(value, ['whatsapp', 'wasap']);
  const phoneRaw = labeledValue(value, ['telefono', 'teléfono', 'celular']);
  const city = labeledValue(value, ['ciudad', 'municipio']);
  const country = labeledValue(value, ['pais', 'país']);
  const address = labeledValue(value, ['direccion', 'dirección']);
  const website = labeledValue(value, ['sitio web', 'web', 'website']);
  const currencyRaw = labeledValue(value, ['moneda']);
  const categories = splitList(labeledValue(value, ['categoria', 'categoría', 'categorias', 'categorías']));
  const specialties = splitList(labeledValue(value, ['especialidad', 'especialidades']));
  const platforms = normalizeProviderPlatforms(labeledValue(value, ['plataforma', 'plataformas']));
  const kinds = normalizeProviderKinds(labeledValue(value, ['tipo', 'tipos', 'tipo de proveedor']));
  const notes = labeledValue(value, ['observaciones', 'observacion', 'observación', 'notas', 'nota']);
  const email = extractEmail(labeledValue(value, ['email', 'correo']) || value);
  const whatsapp = extractPhone(whatsappRaw);
  const phone = extractPhone(phoneRaw);
  const currency = /\bNIO\b|c[oó]rdobas?/i.test(currencyRaw) ? 'NIO' : /\bUSD\b|d[oó]lares?/i.test(currencyRaw) ? 'USD' : '';

  return {
    ...(tradeName ? { name: cleanText(tradeName, 160) } : {}),
    ...(contactName ? { contactName: cleanText(contactName, 160) } : {}),
    ...(legalName ? { legalName: cleanText(legalName, 160) } : {}),
    ...(taxId ? { taxId: cleanText(taxId, 80) } : {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(city ? { city: cleanText(city, 120) } : {}),
    ...(country ? { country: cleanText(country, 120) } : {}),
    ...(address ? { address: cleanText(address, 240) } : {}),
    ...(website ? { website: cleanText(website, 240) } : {}),
    ...(currency ? { currency } : {}),
    ...(categories.length ? { categories } : {}),
    ...(specialties.length ? { specialties } : {}),
    ...(platforms.length ? { platforms } : {}),
    ...(kinds.length ? { kinds } : {}),
    ...(notes ? { notes: cleanText(notes, 500) } : {})
  };
}

function hasStructuredProviderData(value) {
  const data = providerDataFromMessage(value);
  return Boolean(
    data.name || data.contactName || data.legalName || data.taxId || data.whatsapp || data.phone ||
    data.city || data.country || data.address || data.website || data.currency || data.notes ||
    data.categories?.length || data.specialties?.length || data.platforms?.length || data.kinds?.length
  );
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
  const type = options.type || null;
  const providerData = type === 'provider' ? providerDataFromMessage(value) : {};
  const name = providerData.name || extractName(value, options);
  const genericPhone = extractPhone(value);
  const phone = providerData.phone || genericPhone;
  const email = providerData.email || extractEmail(value);
  const relation = extractRelation(value);
  return {
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(relation ? { relation } : {}),
    ...providerData
  };
}

function mergeCommonData(current = {}, incoming = {}) {
  const next = { ...(current && typeof current === 'object' ? current : {}) };
  const stringKeys = [...new Set(['name', 'phone', 'whatsapp', 'email', 'relation', ...PROVIDER_STRING_FIELDS])];
  for (const key of stringKeys) {
    const maxLength = key === 'notes' ? 500 : key === 'address' || key === 'website' ? 240 : key === 'name' || key === 'contactName' || key === 'legalName' ? 160 : 120;
    const value = cleanText(incoming?.[key], maxLength);
    if (value) next[key] = value;
  }
  for (const key of PROVIDER_ARRAY_FIELDS) {
    const currentValues = Array.isArray(next[key]) ? next[key] : [];
    const incomingValues = Array.isArray(incoming?.[key]) ? incoming[key] : [];
    const merged = [...new Set([...currentValues, ...incomingValues].map(item => cleanText(item, 160)).filter(Boolean))];
    if (merged.length) next[key] = merged;
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
  const whatsapp = cleanText(common.whatsapp || phone, 40);
  const email = cleanText(common.email, 160);
  const relation = cleanText(common.relation, 80);
  const contact = {
    ...(phone ? { phone } : {}),
    ...(whatsapp ? { whatsapp } : {})
  };

  if (type === 'customer') {
    return {
      name,
      ...contact,
      ...(email ? { email } : {})
    };
  }

  if (type === 'provider') {
    const platforms = Array.isArray(common.platforms) && common.platforms.length ? common.platforms : ['ELANVISUAL'];
    const kinds = Array.isArray(common.kinds) && common.kinds.length ? common.kinds : ['materials_products'];
    const categories = Array.isArray(common.categories) ? common.categories : [];
    const specialties = Array.isArray(common.specialties) ? common.specialties : [];
    const legalName = cleanText(common.legalName, 160);
    const taxId = cleanText(common.taxId, 80);
    const contactName = cleanText(common.contactName, 160);
    const city = cleanText(common.city, 120);
    const country = cleanText(common.country, 120);
    const address = cleanText(common.address, 240);
    const website = cleanText(common.website, 240);
    const currency = /^(USD|NIO)$/.test(cleanText(common.currency, 3).toUpperCase()) ? cleanText(common.currency, 3).toUpperCase() : '';
    const notes = cleanText(common.notes, 500);
    return {
      tradeName: name,
      ...contact,
      ...(email ? { email } : {}),
      ...(legalName ? { legalName } : {}),
      ...(taxId ? { taxId } : {}),
      ...(contactName ? { contactName } : {}),
      ...(city ? { city } : {}),
      ...(country ? { country } : {}),
      ...(address ? { address } : {}),
      ...(website ? { website } : {}),
      ...(currency ? { currency } : {}),
      platforms,
      kinds,
      ...(categories.length ? { categories } : {}),
      ...(specialties.length ? { specialties } : {}),
      ...(notes ? { notes } : {})
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
  if (pending?.type === 'provider' && hasStructuredProviderData(message)) return true;
  if (!pending?.data?.name && looksLikeStandaloneName(message)) return true;
  return false;
}

async function handleOwnerEntityCreateContinuity({
  message,
  actorKey = '',
  env = process.env,
  now = new Date()
} = {}) {
  const originalMessage = String(message || '').trim().slice(0, 2000);
  const raw = cleanText(originalMessage, 1000);
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

    const initialData = commonDataFromMessage(originalMessage, { allowStandalone: false, type: explicitType });
    const structuredProviderCreate = explicitType === 'provider' && Boolean(providerDataFromMessage(originalMessage).name);

    // Una orden completa ya la resuelve el parser oficial existente. La excepción es
    // el formato estructurado de proveedor (por ejemplo, "Empresa:"), que antes no
    // reconocía el parser canónico y ahora entra por la misma herramienta oficial.
    if (explicitType && initialData.name && !structuredProviderCreate) return { handled: false };

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

  if (!isContinuationCandidate(originalMessage, pending)) return { handled: false };

  const nextType = explicitType || pending.type || null;
  const allowStandalone = !pending?.data?.name;
  const incoming = commonDataFromMessage(originalMessage, { allowStandalone, type: nextType });
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
  providerDataFromMessage,
  commonDataFromMessage,
  mergeCommonData,
  finalizeData,
  promptForPending,
  readyCommand,
  clearPendingEntityCreate,
  handleOwnerEntityCreateContinuity
};
