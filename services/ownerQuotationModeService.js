'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {
  createCustomer,
  searchCustomers
} = require('./ownerBusinessConnectClient');
const { updateContext } = require('./ownerBusinessContextService');
const {
  parsePaymentTerms,
  prepareAndCreateQuotation
} = require('./ownerQuotationService');
const ownerQuotationMediaService = require('./ownerQuotationMediaService');

const DEFAULT_STORE_PATH = '/var/lib/elankav/orchestrator/owner-quotation-mode.json';
const QUOTATION_MODE_TTL_MS = Number(process.env.OWNER_QUOTATION_MODE_TTL_MS || 60 * 60 * 1000);

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function storePath(env = process.env) {
  return String(env.OWNER_QUOTATION_MODE_STORE_PATH || DEFAULT_STORE_PATH).trim() || DEFAULT_STORE_PATH;
}

async function readStore(env = process.env) {
  try {
    const raw = await fs.readFile(storePath(env), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStore(store, env = process.env) {
  const file = storePath(env);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

function stateKey({ externalUserId, phone, chatId } = {}) {
  return String(externalUserId || chatId || phone || 'owner').trim();
}

function freshState(now = Date.now()) {
  return {
    active: true,
    step: 'phone',
    data: {
      phone: '',
      customerName: '',
      description: '',
      paymentTerms: null,
      address: '',
      priceMode: '',
      explicitPriceUsd: null,
      imageProvided: false
    },
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: now + QUOTATION_MODE_TTL_MS
  };
}

async function getState(identity, env = process.env, now = Date.now()) {
  const store = await readStore(env);
  const key = stateKey(identity);
  const state = store[key] || null;
  if (!state) return null;
  if (!state.expiresAt || Number(state.expiresAt) <= now) {
    delete store[key];
    await writeStore(store, env);
    return null;
  }
  return state;
}

async function setState(identity, state, env = process.env, now = Date.now()) {
  const store = await readStore(env);
  const key = stateKey(identity);
  const next = {
    ...state,
    updatedAt: new Date(now).toISOString(),
    expiresAt: now + QUOTATION_MODE_TTL_MS
  };
  store[key] = next;
  await writeStore(store, env);
  return next;
}

async function clearState(identity, env = process.env) {
  const store = await readStore(env);
  delete store[stateKey(identity)];
  await writeStore(store, env);
}

function isQuotationModeStartRequest(text) {
  const value = normalize(text);
  if (!value) return false;
  return (
    /\b(activa|activar|inicia|iniciar|entra|entrar|pon|poner)\b.*\bmodo\s+cotizacion\b/.test(value) ||
    /^modo\s+cotizacion$/.test(value) ||
    /\b(vamos a|quiero|necesito)\b.*\b(cotizar|hacer una cotizacion|crear una cotizacion)\b/.test(value)
  );
}

function isQuotationModeStopRequest(text) {
  const value = normalize(text);
  if (!value) return false;
  return /\b(cancelar|cancela|salir|cerrar|terminar|termina|detener|deten)\b.*\b(cotizacion|modo cotizacion)\b/.test(value);
}

function extractPhone(text) {
  const raw = String(text || '');
  const match = raw.match(/(?:\+?505[\s-]?)?([578]\d{3}[\s-]?\d{4})\b/);
  if (!match) return '';
  return match[0].replace(/\D/g, '').replace(/^505(?=\d{8}$)/, '');
}

function parseDimensions(text) {
  const match = normalize(text).match(/\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\b/);
  if (!match) return {};
  return {
    width: Number(match[1].replace(',', '.')),
    height: Number(match[2].replace(',', '.'))
  };
}

function parsePrice(text) {
  const value = normalize(text);
  if (/\b(usar|usa|toma|tomar)\b.*\b(precio|tarifa)\b.*\b(biblioteca|catalogo|lista)\b/.test(value) ||
      /\bprecio de biblioteca\b/.test(value) ||
      /\bprecio de catalogo\b/.test(value)) {
    return { mode: 'catalog', amountUsd: null };
  }

  const raw = String(text || '');
  const usd = raw.match(/(?:us\$|usd|\$)\s*([0-9]+(?:[.,][0-9]{1,2})?)|([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:usd|dolares|dólares)/i);
  if (usd) {
    const amount = Number(String(usd[1] || usd[2]).replace(',', '.'));
    if (Number.isFinite(amount) && amount > 0) return { mode: 'explicit', amountUsd: amount };
  }

  const plain = raw.match(/^\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$/);
  if (plain) {
    const amount = Number(String(plain[1]).replace(',', '.'));
    if (Number.isFinite(amount) && amount > 0) return { mode: 'explicit', amountUsd: amount };
  }

  return null;
}

function paymentTermsFromText(text) {
  const raw = String(text || '');
  const split = raw.match(/\b(\d{1,3})\s*%?\s*[/\-]\s*(\d{1,3})\s*%?\b/);
  const deposit = raw.match(/\b(?:anticipo|inicial|adelanto)\s*(?:de)?\s*(\d{1,3})\s*%/i);
  if (!split && !deposit) return null;
  return parsePaymentTerms(raw);
}

function isNoImage(text) {
  return /\b(sin imagen|no tengo imagen|no hay imagen|sin foto|no tengo foto|no hay foto)\b/.test(normalize(text));
}

function isUsefulText(text) {
  return String(text || '').trim().length >= 2;
}

function nextQuestion(step) {
  const questions = {
    phone: 'Modo cotización activo. Empecemos por el cliente. ¿Cuál es el número de teléfono o WhatsApp?',
    customerName: '¿Cuál es el nombre del cliente o razón social?',
    description: 'Describime el trabajo que vamos a cotizar. Incluí medidas, cantidad y materiales si ya los tenés.',
    paymentTerms: '¿Cuáles son las condiciones de pago? Por ejemplo 60/40 o anticipo 60%.',
    address: '¿Cuál es la dirección del cliente o del proyecto?',
    price: '¿Cuál es el precio final autorizado en USD? También podés decirme “usar precio de biblioteca”.',
    image: '¿Hay imagen de referencia? Si la hay, enviala ahora. Si no, decime “sin imagen”.'
  };
  return questions[step] || 'Continuemos con la cotización.';
}

function summaryForState(state) {
  const terms = state.data.paymentTerms || {};
  const price = state.data.priceMode === 'catalog'
    ? 'precio de biblioteca'
    : state.data.explicitPriceUsd
      ? `USD ${Number(state.data.explicitPriceUsd).toFixed(2)}`
      : 'pendiente';
  return [
    'Datos de la cotización:',
    `Cliente: ${state.data.customerName || 'pendiente'}`,
    `Teléfono: ${state.data.phone || 'pendiente'}`,
    `Trabajo: ${state.data.description || 'pendiente'}`,
    `Pago: ${terms.depositPercent ? `${terms.depositPercent}/${terms.balancePercent}` : 'pendiente'}`,
    `Dirección: ${state.data.address || 'pendiente'}`,
    `Precio: ${price}`,
    `Imagen: ${state.data.imageProvided ? 'sí' : 'no'}`
  ].join('\n');
}

function customerPhone(customer) {
  return String(customer?.phone || customer?.whatsapp || customer?.mobile || '').replace(/\D/g, '').replace(/^505(?=\d{8}$)/, '');
}

async function resolveOrCreateCustomer(data, dependencies = {}) {
  const searchCustomersImpl = dependencies.searchCustomers || searchCustomers;
  const createCustomerImpl = dependencies.createCustomer || createCustomer;

  const search = await searchCustomersImpl(data.phone);
  const rows = search?.data?.results || [];
  const candidates = rows.map(row => row?.customer || row).filter(Boolean);
  const exact = candidates.find(customer => customerPhone(customer) === data.phone);

  if (exact) return { customer: exact, created: false };

  const response = await createCustomerImpl({
    name: data.customerName,
    companyName: data.customerName,
    whatsapp: data.phone,
    phone: data.phone,
    address: data.address
  });
  const customer = response?.data?.customer || response?.data || response?.customer || response;
  return { customer, created: true };
}

async function finalizeQuotationMode(identity, state, metadata = {}, dependencies = {}) {
  const resolveOrCreateCustomerImpl = dependencies.resolveOrCreateCustomer || resolveOrCreateCustomer;
  const updateContextImpl = dependencies.updateContext || updateContext;
  const prepareAndCreateQuotationImpl = dependencies.prepareAndCreateQuotation || prepareAndCreateQuotation;
  const processMediaImpl = dependencies.processOwnerQuotationMediaMessage || ownerQuotationMediaService.processOwnerQuotationMediaMessage;

  const customerResult = await resolveOrCreateCustomerImpl(state.data, dependencies);
  const customer = customerResult.customer || {};
  const customerId = customer.customerId || customer.id;
  if (!customerId) {
    const error = new Error('QUOTATION_MODE_CUSTOMER_CREATE_FAILED');
    error.code = 'QUOTATION_MODE_CUSTOMER_CREATE_FAILED';
    throw error;
  }

  await updateContextImpl({
    activeCustomerId: customerId,
    activeCustomerReference: state.data.customerName,
    lastEntityType: 'customer',
    lastEntityId: customerId,
    lastIntent: 'quotation_mode'
  });

  const dimensions = parseDimensions(state.data.description || '');
  const input = {
    message: state.data.description,
    productQuery: state.data.description,
    width: dimensions.width,
    height: dimensions.height,
    quantity: 1,
    destination: undefined,
    explicitPrice: state.data.priceMode === 'explicit'
      ? { amount: Number(state.data.explicitPriceUsd), currency: 'USD' }
      : undefined,
    paymentTerms: state.data.paymentTerms || { depositPercent: 60, balancePercent: 40 },
    logisticsRequested: false,
    priceIncludesLogistics: false
  };

  const quotationResult = await prepareAndCreateQuotationImpl(input);
  if (!quotationResult?.ready || !quotationResult?.created) {
    return {
      completed: false,
      outputText: quotationResult?.question || 'No pude completar la cotización formal.',
      quotationResult
    };
  }

  let mediaResult = null;
  if (state.data.imageProvided) {
    mediaResult = await processMediaImpl({
      message: 'ELAN agregá esta imagen a la cotización',
      metadata: {},
      externalUserId: identity.externalUserId || identity.chatId || null,
      phone: identity.phone || null
    });
  }

  await clearState(identity);

  return {
    completed: true,
    outputText: [
      quotationResult.summary,
      mediaResult?.handled ? '' : '',
      mediaResult?.handled ? mediaResult.outputText : ''
    ].filter(Boolean).join('\n\n'),
    quotationResult,
    mediaResult
  };
}

async function startQuotationMode(identity, env = process.env) {
  const state = freshState();
  await setState(identity, state, env);
  return {
    handled: true,
    mode: 'quotation',
    status: 'in_progress',
    outputText: nextQuestion('phone'),
    state
  };
}

async function processQuotationModeText({ identity, text, metadata = {}, dependencies = {}, env = process.env }) {
  if (isQuotationModeStartRequest(text)) return startQuotationMode(identity, env);

  const state = await getState(identity, env);
  if (!state?.active) return { handled: false };

  if (isQuotationModeStopRequest(text)) {
    await clearState(identity, env);
    return {
      handled: true,
      mode: 'quotation',
      status: 'cancelled',
      outputText: 'Modo cotización cancelado. No creé ni envié ninguna cotización.'
    };
  }

  const next = JSON.parse(JSON.stringify(state));

  if (next.step === 'phone') {
    const phone = extractPhone(text);
    if (!phone) return { handled: true, mode: 'quotation', status: 'in_progress', outputText: 'Necesito un número válido de teléfono o WhatsApp del cliente.' };
    next.data.phone = phone;
    next.step = 'customerName';
  } else if (next.step === 'customerName') {
    if (!isUsefulText(text)) return { handled: true, mode: 'quotation', status: 'in_progress', outputText: nextQuestion('customerName') };
    next.data.customerName = String(text).trim();
    next.step = 'description';
  } else if (next.step === 'description') {
    if (String(text || '').trim().length < 5) return { handled: true, mode: 'quotation', status: 'in_progress', outputText: 'Necesito una descripción un poco más completa del trabajo.' };
    next.data.description = String(text).trim();
    next.step = 'paymentTerms';
  } else if (next.step === 'paymentTerms') {
    const terms = paymentTermsFromText(text);
    if (!terms) return { handled: true, mode: 'quotation', status: 'in_progress', outputText: 'Indicame las condiciones como 60/40, 50/50 o “anticipo 60%”.' };
    next.data.paymentTerms = terms;
    next.step = 'address';
  } else if (next.step === 'address') {
    if (!isUsefulText(text)) return { handled: true, mode: 'quotation', status: 'in_progress', outputText: nextQuestion('address') };
    next.data.address = String(text).trim();
    next.step = 'price';
  } else if (next.step === 'price') {
    const price = parsePrice(text);
    if (!price) return { handled: true, mode: 'quotation', status: 'in_progress', outputText: 'Indicame el precio final en USD o decime “usar precio de biblioteca”.' };
    next.data.priceMode = price.mode;
    next.data.explicitPriceUsd = price.amountUsd;
    next.step = 'image';
  } else if (next.step === 'image') {
    if (!isNoImage(text)) {
      return {
        handled: true,
        mode: 'quotation',
        status: 'in_progress',
        outputText: 'Si tenés imagen, enviala como foto. Si no hay imagen, decime “sin imagen”.'
      };
    }
    next.data.imageProvided = false;
    await setState(identity, next, env);
    const final = await finalizeQuotationMode(identity, next, metadata, dependencies);
    return {
      handled: true,
      mode: 'quotation',
      status: final.completed ? 'completed' : 'in_progress',
      outputText: final.outputText,
      result: final
    };
  }

  await setState(identity, next, env);
  return {
    handled: true,
    mode: 'quotation',
    status: 'in_progress',
    outputText: nextQuestion(next.step),
    state: next
  };
}

async function processQuotationModeImage({ identity, media, metadata = {}, dependencies = {}, env = process.env }) {
  const state = await getState(identity, env);
  if (!state?.active || state.step !== 'image') return { handled: false };
  if (!media?.url) {
    return {
      handled: true,
      mode: 'quotation',
      status: 'in_progress',
      outputText: 'Recibí la imagen, pero todavía no tengo una referencia descargable. Reenviámela como foto normal.'
    };
  }

  ownerQuotationMediaService.savePendingMedia(identity, media);
  const next = JSON.parse(JSON.stringify(state));
  next.data.imageProvided = true;
  await setState(identity, next, env);

  const final = await finalizeQuotationMode(identity, next, metadata, dependencies);
  return {
    handled: true,
    mode: 'quotation',
    status: final.completed ? 'completed' : 'in_progress',
    outputText: final.outputText,
    result: final
  };
}

module.exports = {
  DEFAULT_STORE_PATH,
  QUOTATION_MODE_TTL_MS,
  clearState,
  extractPhone,
  finalizeQuotationMode,
  freshState,
  getState,
  isNoImage,
  isQuotationModeStartRequest,
  isQuotationModeStopRequest,
  nextQuestion,
  parsePrice,
  paymentTermsFromText,
  processQuotationModeImage,
  processQuotationModeText,
  resolveOrCreateCustomer,
  setState,
  stateKey,
  summaryForState
};
