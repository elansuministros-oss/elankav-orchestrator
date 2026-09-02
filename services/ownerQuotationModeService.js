'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {
  createCustomer,
  getProspectTimeline,
  searchCustomers,
  searchProspects
} = require('./ownerBusinessConnectClient');
const { updateContext } = require('./ownerBusinessContextService');
const {
  parsePaymentTerms,
  prepareAndCreateQuotation
} = require('./ownerQuotationService');
const ownerQuotationMediaService = require('./ownerQuotationMediaService');
const { extractQuotationIntakeFromImage } = require('./ownerQuotationImageExtractionService');

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

function stripHonorifics(value) {
  return normalize(value)
    .replace(/^(?:dr|dra|doctor|doctora|lic|licda|licenciado|licenciada|ing|ingeniero|ingeniera|arq|arquitecto|arquitecta|sr|sra|senor|senora)\.?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function referenceVariants(value) {
  const raw = String(value || '').trim();
  const variants = [raw, stripHonorifics(raw)]
    .map(item => String(item || '').trim())
    .filter(Boolean);
  return [...new Set(variants)];
}

function normalizedReference(value) {
  return stripHonorifics(value);
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
    step: 'party',
    data: {
      sourceType: '',
      sourceId: '',
      customerName: '',
      companyName: '',
      phone: '',
      email: '',
      address: '',
      description: '',
      paymentTerms: null,
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
  return /\b(cancelar|cancela|sal|salir|cerrar|terminar|termina|detener|deten)\b.*\b(cotizacion|modo cotizacion)\b/.test(value);
}

function isQuotationModeBypassRequest(text) {
  const value = normalize(text);
  if (!value) return false;
  const operational =
    /\b(despliega|desplegar|deploy|estado|status|logs?|supervisor|commit|rama|branch|health|salud|reinicia|restart|owner ops|ops-|whatsapp core|waha)\b/.test(value);
  const prospecting =
    /\b(prospectos?|empresas|campana|campanas|outreach|prospeccion)\b/.test(value) &&
    /\b(correo|correos|email|emails|whatsapp|whatsap|wasap|mensajes?|contacta|contactar|manda|mandar|envia|enviar|ataca|pausa|reanuda|reporte|resumen)\b/.test(value);
  return operational || prospecting;
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
    party: [
      '✅ Modo cotización activo.',
      '¿Para quién es la cotización?',
      'Podés decirme el nombre del cliente/negocio, el teléfono, o mandarme una captura con los datos. Primero buscaré si ya existe como cliente o prospecto.'
    ].join('\n'),
    phone: '¿Cuál es el número de teléfono o WhatsApp del cliente?',
    customerName: '¿Cuál es el nombre del cliente o del negocio?',
    description: 'Describime el trabajo que vamos a cotizar. Incluí medidas, cantidad y materiales si ya los tenés.',
    paymentTerms: '¿Cuáles son las condiciones de pago? Por ejemplo 60/40 o anticipo 60%.',
    address: '¿Cuál es la dirección del cliente o del proyecto?',
    price: '¿Cuál es el precio final autorizado en USD? También podés decirme “usar precio de biblioteca”.',
    image: '¿Hay imagen de referencia para la cotización? Si la hay, enviala ahora. Si no, decime “sin imagen”.'
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
    `Origen: ${state.data.sourceType || 'nuevo'}`,
    `Cliente: ${state.data.customerName || 'pendiente'}`,
    `Negocio: ${state.data.companyName || 'pendiente'}`,
    `Teléfono: ${state.data.phone || 'pendiente'}`,
    `Trabajo: ${state.data.description || 'pendiente'}`,
    `Pago: ${terms.depositPercent ? `${terms.depositPercent}/${terms.balancePercent}` : 'pendiente'}`,
    `Dirección: ${state.data.address || 'pendiente'}`,
    `Precio: ${price}`,
    `Imagen: ${state.data.imageProvided ? 'sí' : 'no'}`
  ].join('\n');
}

function customerPhone(customer) {
  return String(customer?.phone || customer?.whatsapp || customer?.mobile || '')
    .replace(/\D/g, '')
    .replace(/^505(?=\d{8}$)/, '');
}

function customerNames(customer) {
  return [customer?.name, customer?.companyName, customer?.displayName]
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function chooseCustomer(rows, reference) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .map(row => row?.customer || row)
    .filter(Boolean);
  if (!candidates.length) return { status: 'not_found', candidates: [] };

  const wanted = normalizedReference(reference);
  const phone = extractPhone(reference);
  const exact = candidates.filter(customer => {
    if (phone && customerPhone(customer) === phone) return true;
    return customerNames(customer).some(name => {
      const normalizedName = normalizedReference(name);
      return normalizedName === wanted ||
        (wanted.length >= 4 && normalizedName.includes(wanted)) ||
        (normalizedName.length >= 4 && wanted.includes(normalizedName));
    });
  });

  if (exact.length === 1) return { status: 'selected', customer: exact[0], candidates };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };
  if (candidates.length === 1) return { status: 'selected', customer: candidates[0], candidates };
  return { status: 'ambiguous', candidates };
}

function prospectRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.prospects)) return payload.prospects;
  return [];
}

function chooseProspect(payload, reference) {
  const rows = prospectRows(payload);
  if (!rows.length) return { status: 'not_found', candidates: [] };
  const wanted = normalizedReference(reference);
  const exact = rows.filter(row => {
    const company = normalizedReference(row?.companyName);
    return company === wanted ||
      (wanted.length >= 4 && company.includes(wanted)) ||
      (company.length >= 4 && wanted.includes(company));
  });
  if (exact.length === 1) return { status: 'selected', prospect: exact[0], candidates: rows };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };
  if (rows.length === 1) return { status: 'selected', prospect: rows[0], candidates: rows };
  return { status: 'ambiguous', candidates: rows };
}

function preferredProspectContact(timeline = {}) {
  const contacts = Array.isArray(timeline?.contacts) ? timeline.contacts : [];
  const preferred = ['whatsapp', 'phone', 'email'];
  for (const channel of preferred) {
    const match = contacts.find(contact =>
      String(contact?.channel || '').toLowerCase() === channel &&
      String(contact?.value || '').trim()
    );
    if (match) return match;
  }
  return contacts.find(contact => String(contact?.value || '').trim()) || null;
}

function applyResolvedParty(state, resolved = {}) {
  const next = JSON.parse(JSON.stringify(state));
  const companyName = String(resolved.companyName || '').trim();
  const customerName = String(resolved.customerName || '').trim() || companyName;
  next.data.sourceType = resolved.sourceType || next.data.sourceType || 'new';
  next.data.sourceId = String(resolved.sourceId || next.data.sourceId || '').trim();
  next.data.companyName = companyName || customerName || next.data.companyName;
  next.data.customerName = customerName || next.data.customerName;
  next.data.phone = String(resolved.phone || next.data.phone || '').replace(/\D/g, '').replace(/^505(?=\d{8}$)/, '');
  next.data.email = String(resolved.email || next.data.email || '').trim();
  next.data.address = String(resolved.address || next.data.address || '').trim();
  if (resolved.description) next.data.description = String(resolved.description).trim();
  return next;
}

function nextMissingStep(data) {
  if (!data.phone) return 'phone';
  if (!data.customerName && !data.companyName) return 'customerName';
  if (!data.description) return 'description';
  if (!data.paymentTerms) return 'paymentTerms';
  if (!data.address) return 'address';
  if (!data.priceMode) return 'price';
  return 'image';
}

async function resolvePartyReference(reference, dependencies = {}) {
  const query = String(reference || '').trim();
  if (!query) return { status: 'not_found' };

  const searchCustomersImpl = dependencies.searchCustomers || searchCustomers;
  const searchProspectsImpl = dependencies.searchProspects || searchProspects;
  const getProspectTimelineImpl = dependencies.getProspectTimeline || getProspectTimeline;
  const variants = referenceVariants(query);

  let customerRows = [];
  for (const variant of variants) {
    const customerSearch = await searchCustomersImpl(variant);
    const rows = customerSearch?.data?.results || customerSearch?.results || [];
    if (Array.isArray(rows)) customerRows.push(...rows);
  }
  const customerChoice = chooseCustomer(customerRows, query);
  if (customerChoice.status === 'selected') {
    const customer = customerChoice.customer;
    const companyName = String(customer.companyName || '').trim();
    const customerName = String(customer.name || customer.displayName || companyName).trim();
    return {
      status: 'selected',
      sourceType: 'customer',
      sourceId: customer.customerId || customer.id || '',
      customerName: customerName || companyName,
      companyName: companyName || customerName,
      phone: customerPhone(customer),
      email: customer.email || '',
      address: customer.address || '',
      customer
    };
  }
  if (customerChoice.status === 'ambiguous') {
    return {
      status: 'ambiguous_customer',
      candidates: customerChoice.candidates
    };
  }

  let prospectCandidates = [];
  for (const variant of variants) {
    const prospectSearch = await searchProspectsImpl(variant);
    prospectCandidates.push(...prospectRows(prospectSearch));
  }
  const prospectChoice = chooseProspect(prospectCandidates, query);
  if (prospectChoice.status === 'selected') {
    const prospect = prospectChoice.prospect;
    let timeline = {};
    try {
      timeline = await getProspectTimelineImpl(prospect.id);
    } catch {
      timeline = {};
    }
    const contact = preferredProspectContact(timeline);
    const companyName = String(prospect.companyName || '').trim();
    const contactName = String(contact?.contactName || '').trim();
    const channel = String(contact?.channel || '').toLowerCase();
    const value = String(contact?.value || '').trim();
    return {
      status: 'selected',
      sourceType: 'prospect',
      sourceId: prospect.id || '',
      customerName: contactName || companyName,
      companyName,
      phone: ['whatsapp', 'phone'].includes(channel) ? extractPhone(value) || value.replace(/\D/g, '') : '',
      email: channel === 'email' ? value : '',
      address: prospect.address || '',
      prospect,
      contact
    };
  }
  if (prospectChoice.status === 'ambiguous') {
    return {
      status: 'ambiguous_prospect',
      candidates: prospectChoice.candidates
    };
  }

  const phone = extractPhone(query);
  if (phone) {
    return {
      status: 'new',
      sourceType: 'new',
      phone
    };
  }

  return {
    status: 'new',
    sourceType: 'new',
    customerName: query,
    companyName: query
  };
}

function formatAmbiguousParty(result) {
  const rows = Array.isArray(result?.candidates) ? result.candidates.slice(0, 5) : [];
  const names = rows.map(row =>
    row?.companyName ||
    row?.name ||
    row?.displayName ||
    row?.customer?.companyName ||
    row?.customer?.name ||
    ''
  ).filter(Boolean);
  return names.length
    ? `Encontré varias coincidencias: ${names.join(', ')}. Decime cuál corresponde.`
    : 'Encontré varias coincidencias. Dame un dato más específico del cliente o negocio.';
}

async function resolveOrCreateCustomer(data, dependencies = {}) {
  const searchCustomersImpl = dependencies.searchCustomers || searchCustomers;
  const createCustomerImpl = dependencies.createCustomer || createCustomer;

  if (data.sourceType === 'customer' && data.sourceId) {
    const search = await searchCustomersImpl(data.sourceId);
    const rows = search?.data?.results || [];
    const exact = rows.map(row => row?.customer || row).find(customer =>
      String(customer?.customerId || customer?.id || '') === String(data.sourceId)
    );
    if (exact) return { customer: exact, created: false };
  }

  if (data.phone) {
    const search = await searchCustomersImpl(data.phone);
    const rows = search?.data?.results || [];
    const candidates = rows.map(row => row?.customer || row).filter(Boolean);
    const exact = candidates.find(customer => customerPhone(customer) === data.phone);
    if (exact) return { customer: exact, created: false };
  }

  const customerName = String(data.customerName || data.companyName || '').trim();
  const companyName = String(data.companyName || data.customerName || '').trim();
  const response = await createCustomerImpl({
    name: customerName || companyName,
    companyName: companyName || customerName,
    ...(data.phone ? { whatsapp: data.phone, phone: data.phone } : {}),
    ...(data.email ? { email: data.email } : {}),
    ...(data.address ? { address: data.address } : {})
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
    activeCustomerReference: state.data.customerName || state.data.companyName,
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
    outputText: nextQuestion('party'),
    state
  };
}

async function processQuotationModeText({ identity, text, metadata = {}, dependencies = {}, env = process.env }) {
  if (isQuotationModeStartRequest(text)) return startQuotationMode(identity, env);

  const state = await getState(identity, env);
  if (!state?.active) return { handled: false };

  if (isQuotationModeBypassRequest(text)) {
    return { handled: false, bypassed: true, mode: 'quotation' };
  }

  if (isQuotationModeStopRequest(text)) {
    await clearState(identity, env);
    return {
      handled: true,
      mode: 'quotation',
      status: 'cancelled',
      outputText: 'Modo cotización cancelado. No creé ni envié ninguna cotización.'
    };
  }

  let next = JSON.parse(JSON.stringify(state));

  if (next.step === 'party') {
    const resolved = await resolvePartyReference(text, dependencies);
    if (resolved.status === 'ambiguous_customer' || resolved.status === 'ambiguous_prospect') {
      return {
        handled: true,
        mode: 'quotation',
        status: 'in_progress',
        outputText: formatAmbiguousParty(resolved)
      };
    }
    next = applyResolvedParty(next, resolved);
    next.step = nextMissingStep(next.data);
  } else if (next.step === 'phone') {
    const phone = extractPhone(text);
    if (!phone) {
      return {
        handled: true,
        mode: 'quotation',
        status: 'in_progress',
        outputText: 'Necesito un número válido de teléfono o WhatsApp del cliente.'
      };
    }
    next.data.phone = phone;
    next.step = nextMissingStep(next.data);
  } else if (next.step === 'customerName') {
    if (!isUsefulText(text)) {
      return { handled: true, mode: 'quotation', status: 'in_progress', outputText: nextQuestion('customerName') };
    }
    const name = String(text).trim();
    next.data.customerName = name;
    if (!next.data.companyName) next.data.companyName = name;
    next.step = nextMissingStep(next.data);
  } else if (next.step === 'description') {
    if (String(text || '').trim().length < 5) {
      return {
        handled: true,
        mode: 'quotation',
        status: 'in_progress',
        outputText: 'Necesito una descripción un poco más completa del trabajo.'
      };
    }
    next.data.description = String(text).trim();
    next.step = nextMissingStep(next.data);
  } else if (next.step === 'paymentTerms') {
    const terms = paymentTermsFromText(text);
    if (!terms) {
      return {
        handled: true,
        mode: 'quotation',
        status: 'in_progress',
        outputText: 'Indicame las condiciones como 60/40, 50/50 o “anticipo 60%”.'
      };
    }
    next.data.paymentTerms = terms;
    next.step = nextMissingStep(next.data);
  } else if (next.step === 'address') {
    if (!isUsefulText(text)) {
      return { handled: true, mode: 'quotation', status: 'in_progress', outputText: nextQuestion('address') };
    }
    next.data.address = String(text).trim();
    next.step = nextMissingStep(next.data);
  } else if (next.step === 'price') {
    const price = parsePrice(text);
    if (!price) {
      return {
        handled: true,
        mode: 'quotation',
        status: 'in_progress',
        outputText: 'Indicame el precio final en USD o decime “usar precio de biblioteca”.'
      };
    }
    next.data.priceMode = price.mode;
    next.data.explicitPriceUsd = price.amountUsd;
    next.step = nextMissingStep(next.data);
  } else if (next.step === 'image') {
    if (!isNoImage(text)) {
      return {
        handled: true,
        mode: 'quotation',
        status: 'in_progress',
        outputText: 'Si tenés imagen de referencia, enviala como foto. Si no hay imagen, decime “sin imagen”.'
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
  const sourceNote = next.data.sourceType === 'customer'
    ? '✅ Encontré el cliente registrado. '
    : next.data.sourceType === 'prospect'
      ? '✅ Encontré el prospecto y reutilicé sus datos disponibles. '
      : '';
  return {
    handled: true,
    mode: 'quotation',
    status: 'in_progress',
    outputText: `${sourceNote}${nextQuestion(next.step)}`.trim(),
    state: next
  };
}

async function processQuotationModeImage({ identity, media, metadata = {}, dependencies = {}, env = process.env }) {
  const state = await getState(identity, env);
  if (!state?.active) return { handled: false };

  if (!media?.url) {
    return {
      handled: true,
      mode: 'quotation',
      status: 'in_progress',
      outputText: 'Recibí la imagen, pero todavía no tengo una referencia descargable. Reenviámela como foto normal.'
    };
  }

  if (state.step === 'party') {
    const extractImpl = dependencies.extractQuotationIntakeFromImage || extractQuotationIntakeFromImage;
    const extracted = await extractImpl({ media });
    const companyName = String(extracted.companyName || '').trim();
    const customerName = String(extracted.customerName || '').trim() || companyName;
    const reference = customerName || companyName || extracted.phone || '';

    let resolved = null;
    if (reference) {
      try {
        resolved = await resolvePartyReference(reference, dependencies);
      } catch {
        resolved = null;
      }
    }

    let next = applyResolvedParty(state, resolved?.status === 'selected' ? resolved : {
      sourceType: 'new',
      customerName,
      companyName: companyName || customerName,
      phone: extracted.phone,
      email: extracted.email,
      address: extracted.address,
      description: extracted.workDescription || extracted.productName
    });

    if (!next.data.customerName && next.data.companyName) {
      next.data.customerName = next.data.companyName;
    }
    if (!next.data.companyName && next.data.customerName) {
      next.data.companyName = next.data.customerName;
    }
    if (!next.data.phone && extracted.phone) next.data.phone = extracted.phone;
    if (!next.data.email && extracted.email) next.data.email = extracted.email;
    if (!next.data.address && extracted.address) next.data.address = extracted.address;
    if (!next.data.description && (extracted.workDescription || extracted.productName)) {
      next.data.description = extracted.workDescription || extracted.productName;
    }

    next.step = nextMissingStep(next.data);
    await setState(identity, next, env);

    const identityText = next.data.customerName || next.data.companyName
      ? `Identifiqué: ${next.data.customerName || next.data.companyName}.`
      : 'No pude identificar con suficiente claridad el cliente o negocio.';
    return {
      handled: true,
      mode: 'quotation',
      status: 'in_progress',
      outputText: [
        '✅ Captura procesada para la cotización.',
        identityText,
        next.data.companyName ? `Negocio: ${next.data.companyName}` : '',
        next.data.description ? `Trabajo detectado: ${next.data.description}` : '',
        '',
        nextQuestion(next.step)
      ].filter(Boolean).join('\n'),
      state: next,
      extracted
    };
  }

  if (state.step !== 'image') {
    return {
      handled: true,
      mode: 'quotation',
      status: 'in_progress',
      outputText: `Todavía estamos completando los datos de la cotización. ${nextQuestion(state.step)}`
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
  applyResolvedParty,
  chooseCustomer,
  chooseProspect,
  clearState,
  extractPhone,
  finalizeQuotationMode,
  freshState,
  getState,
  isNoImage,
  isQuotationModeBypassRequest,
  isQuotationModeStartRequest,
  isQuotationModeStopRequest,
  nextMissingStep,
  nextQuestion,
  parsePrice,
  paymentTermsFromText,
  preferredProspectContact,
  processQuotationModeImage,
  processQuotationModeText,
  prospectRows,
  referenceVariants,
  resolveOrCreateCustomer,
  resolvePartyReference,
  setState,
  stateKey,
  stripHonorifics,
  summaryForState
};
