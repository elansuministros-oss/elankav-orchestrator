'use strict';

const {
  createCustomer,
  createLogisticsRule,
  listCustomers,
  listProviders,
  listQuotations,
  searchCustomers,
  searchProviders
} = require('./ownerBusinessConnectClient');
const { createWahaDeliveryAdapter, normalizePhone } = require('../adapters/wahaDeliveryAdapter');
const { readContext, updateContext } = require('./ownerBusinessContextService');
const { createPendingOperation, formatPendingOperation } = require('./ownerOpsConfirmationService');
const { recordAuditSafely } = require('./ownerOpsAuditService');
const { parseQuotationRequest, prepareAndCreateQuotation } = require('./ownerQuotationService');
const {
  isProviderServiceRegistrationRequest,
  processOwnerProviderServiceRegistration
} = require('./ownerProviderServiceRegistrationService');

const BUSINESS_COMMANDS = Object.freeze({
  CUSTOMER_CREATE: 'business_customer_create',
  CUSTOMER_SEARCH: 'business_customer_search',
  CUSTOMER_LIST: 'business_customer_list',
  PROVIDER_SEARCH: 'business_provider_search',
  PROVIDER_LIST: 'business_provider_list',
  PROVIDER_QUOTE_REQUEST: 'business_provider_quote_request',
  PROVIDER_SERVICE_REGISTER: 'business_provider_service_register',
  PRICE_AUTH_CREATE: 'business_price_authorization_create',
  LOGISTICS_RULE_CREATE: 'business_logistics_rule_create',
  QUOTATION_CREATE: 'business_quotation_create',
  QUOTATION_LOOKUP: 'business_quotation_lookup',
  QUOTATION_LOOKUP_SEND: 'business_quotation_lookup_send',
  QUOTATION_CUSTOMER_LIST: 'business_quotation_customer_list',
  QUOTATION_SPLIT_SEND: 'business_quotation_split_send',
  QUOTATION_LATEST: 'business_quotation_latest',
  QUOTATION_RECENT: 'business_quotation_recent'
});

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function labeledValue(message, labels) {
  const lines = String(message || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const normalized = normalize(line);
    for (const label of labels) {
      const prefix = `${normalize(label)}:`;
      if (normalized.startsWith(prefix)) return line.slice(line.indexOf(':') + 1).trim();
    }
  }
  return '';
}

function parseCustomerCreate(message) {
  const normalized = normalize(message);
  if (!/(agrega|agregar|crea|crear|registra|registrar).{0,20}(cliente)/.test(normalized)) return null;
  const name = labeledValue(message, ['nombre', 'cliente']);
  const companyName = labeledValue(message, ['empresa', 'negocio', 'compañia', 'compania']);
  const whatsapp = labeledValue(message, ['whatsapp', 'wasap', 'telefono', 'teléfono', 'celular']);
  const address = labeledValue(message, ['direccion', 'dirección']);
  const city = labeledValue(message, ['ciudad', 'municipio']);
  const email = labeledValue(message, ['email', 'correo']);
  if (!name && !companyName) return null;
  return {
    type: BUSINESS_COMMANDS.CUSTOMER_CREATE,
    input: {
      name: name || companyName,
      ...(companyName ? { companyName } : {}),
      ...(whatsapp ? { whatsapp } : {}),
      ...(address ? { address } : {}),
      ...(city ? { city } : {}),
      ...(email ? { email } : {})
    }
  };
}

function parseCustomerList(message) {
  const normalized = normalize(message);
  const hasCustomer = /\bclientes?\b/.test(normalized);
  if (!hasCustomer) return null;

  const asksList = /\b(lista|listar|muestra|mostrar|busca|buscar|dime|decime|cuales|registrados|tenemos)\b/.test(normalized);
  const asksCount = /\b(cuantos|cantidad|total)\b/.test(normalized);
  const genericCollection = /\b(clientes?\s+(?:que\s+)?tenemos|clientes?\s+registrados|todos\s+los\s+clientes?|lista\s+(?:de\s+)?clientes?)\b/.test(normalized);

  if (!asksList && !asksCount && !genericCollection) return null;

  const specificSearch = normalized.match(/^(?:elan\s+)?(?:busca|buscar|encuentra|encontra|localiza)\s+(?:al\s+|el\s+|la\s+)?cliente\s+(.+)$/);
  if (specificSearch) return null;

  return {
    type: BUSINESS_COMMANDS.CUSTOMER_LIST,
    sort: 'alphabetical',
    countOnly: asksCount && !asksList && !genericCollection
  };
}

function parseCustomerSearch(message) {
  const normalized = normalize(message);
  const match = normalized.match(/^(?:elan\s+)?(?:busca|buscar|encuentra|encontra|localiza)\s+(?:al\s+|el\s+|la\s+)?cliente\s+(.+)$/);
  if (!match) return null;
  return { type: BUSINESS_COMMANDS.CUSTOMER_SEARCH, query: match[1].trim() };
}

function parseQuotationReadRequest(message) {
  const normalized = normalize(message).replace(/^elan[\s,;:]+/, '').trim();
  if (!/\bcotizacion(?:es)?\b/.test(normalized)) return null;

  const asksLatest =
    /\b(ultima|ultimo|mas reciente|reciente)\b/.test(normalized) &&
    /\b(cotizacion|cotizaciones)\b/.test(normalized);

  const asksRecentList =
    /\b(ultimas|ultimos|recientes)\b/.test(normalized) &&
    /\bcotizaciones\b/.test(normalized);

  if (asksRecentList) {
    return {
      type: BUSINESS_COMMANDS.QUOTATION_RECENT,
      limit: 5
    };
  }

  if (asksLatest) {
    return {
      type: BUSINESS_COMMANDS.QUOTATION_LATEST,
      limit: 1
    };
  }

  return null;
}

function parseQuotationSplitSend(message) {
  const normalized = normalize(message)
    .replace(/^elan[\s,;:]+/, '')
    .replace(/[.!?]+$/g, '')
    .trim();

  const sendIntent = /\b(envia|enviar|enviale|envialas|enviaselas|manda|mandar|mandale|mandalas|mandaselas|comparte|compartir|compartile|compartilas|compartiselas)\b/.test(normalized);
  if (!sendIntent) return null;

  const explicitPluralObject =
    /\b(cotizaciones|alternativas|propuestas)\b/.test(normalized) ||
    /\b(las\s+dos|ambas|esas\s+dos|estas\s+dos|las\s+ultimas|las\s+últimas)\b/.test(normalized) ||
    /\b(enviaselas|mandaselas|compartiselas)\b/.test(normalized);

  if (!explicitPluralObject) return null;

  const explicitCountMatch = normalized.match(/\b(\d+)\s+(?:cotizaciones|alternativas|propuestas)\b/);
  const expectedCount = explicitCountMatch
    ? Math.max(2, Number(explicitCountMatch[1]))
    : (/\b(dos|las\s+dos|ambas|esas\s+dos|estas\s+dos)\b/.test(normalized) ? 2 : null);

  const customerPatterns = [
    /\b(?:al\s+cliente|cliente)\s+(.+?)(?=[,;.]|$)/,
    /\b(?:a|para)\s+([a-z0-9][a-z0-9 .&'_-]{1,80}?)(?=[,;.]|$)/
  ];
  let customerReference = '';
  for (const pattern of customerPatterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const candidate = match[1]
      .replace(/^(?:el|la)\s+cliente\s+/,'')
      .trim();
    if (!candidate || /^(?:las?|los?)\s+(?:dos|cotizaciones|alternativas|propuestas)$/.test(candidate)) continue;
    customerReference = candidate;
    break;
  }

  return {
    type: BUSINESS_COMMANDS.QUOTATION_SPLIT_SEND,
    ...(expectedCount ? { expectedCount } : {}),
    ...(customerReference ? { customerReference } : {})
  };
}

function parseQuotationCustomerList(message) {
  const normalized = normalize(message).replace(/^elan[\s,;:]+/, '').trim();
  if (!/\bcotizaciones\b/.test(normalized)) return null;
  if (!/\b(busca|buscar|muestra|mostrar|lista|listar|dame|hay|tenemos|tengamos)\b/.test(normalized)) return null;

  const patterns = [
    /\bcotizaciones\s+(?:del|de\s+la|de|para\s+el|para\s+la)\s+cliente\s+(.+?)(?=\s+que\s+(?:hay|tenemos|tengamos)\b|[,.;!?]|$)/,
    /\bcotizaciones\s+(?:del|de\s+la|de|para)\s+(.+?)(?=\s+que\s+(?:hay|tenemos|tengamos)\b|[,.;!?]|$)/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const customerReference = String(match?.[1] || '').trim();
    if (!customerReference || /^(?:cliente|clientes)$/.test(customerReference)) continue;
    return {
      type: BUSINESS_COMMANDS.QUOTATION_CUSTOMER_LIST,
      customerReference
    };
  }

  return null;
}

function parseQuotationLookupSend(message) {
  const raw = String(message || '').trim();
  const normalized = normalize(raw).replace(/^elan[\s,;:]+/, '').trim();
  if (!/\bcotizacion\b/.test(normalized)) return null;
  if (!/\b(busca|buscar|encuentra|encontra|localiza)\b/.test(normalized)) return null;
  if (!/\b(envia|enviale|manda|mandale|comparte|compartile)\b/.test(normalized)) return null;

  const match = normalized.match(
    /\bcotizacion\s+(?:del|de\s+la|de|para\s+el|para\s+la|para)?\s*cliente\s+(.+?)(?=\s+(?:y\s+)?(?:envia|enviale|manda|mandale|comparte|compartile)\b|[,.;]|$)/
  );
  if (!match?.[1]) return null;
  const customerReference = match[1].trim();
  if (!customerReference) return null;

  return {
    type: BUSINESS_COMMANDS.QUOTATION_LOOKUP_SEND,
    customerReference
  };
}

function parseQuotationLookup(message) {
  const normalized = normalize(message).replace(/^elan[\s,;:]+/, '').trim();
  if (!/\bcotizacion\b/.test(normalized)) return null;
  if (!/\b(busca|buscar|encuentra|encontra|localiza)\b/.test(normalized)) return null;
  if (/\b(envia|enviale|manda|mandale|comparte|compartile)\b/.test(normalized)) return null;

  const match = normalized.match(
    /\bcotizacion\s+(?:del|de\s+la|de|para\s+el|para\s+la|para)?\s*cliente\s+(.+?)(?=[,.;!?]|$)/
  );
  if (!match?.[1]) return null;
  const customerReference = match[1].trim();
  if (!customerReference) return null;

  return {
    type: BUSINESS_COMMANDS.QUOTATION_LOOKUP,
    customerReference
  };
}

function quotationRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.quotations)) return payload.data.quotations;
  if (Array.isArray(payload?.quotations)) return payload.quotations;
  if (Array.isArray(payload)) return payload;
  return [];
}

function quotationPublicDocument(row) {
  return row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
}

function quotationRelations(row) {
  const publicDocument = quotationPublicDocument(row);
  return row?.relations || publicDocument?.relations || publicDocument?.project?.relations || {};
}

function quotationProjectTitle(row) {
  const publicDocument = quotationPublicDocument(row);
  return String(
    row?.project_title ||
    row?.projectTitle ||
    publicDocument?.project?.title ||
    ''
  ).trim();
}

function quotationSplitTitleMetadata(row) {
  const title = quotationProjectTitle(row);
  if (!title) return null;
  const match = title.match(/^(.*?)\s+[—-]\s+Alternativa\s+(\d+)\s*:\s*(.+)$/i);
  if (!match) return null;
  const baseTitle = String(match[1] || '').trim();
  const partIndex = Number(match[2]);
  const partTitle = String(match[3] || '').trim();
  if (!baseTitle || !Number.isInteger(partIndex) || partIndex < 1) return null;
  return { baseTitle, partIndex, partTitle };
}

function quotationCustomerReferences(row) {
  const publicDocument = quotationPublicDocument(row);
  return [
    row?.customer_name,
    row?.customerName,
    row?.customer_company_name,
    row?.customerCompanyName,
    row?.customer_snapshot?.name,
    row?.customer_snapshot?.companyName,
    publicDocument?.customer?.name,
    publicDocument?.customer?.companyName
  ].map(value => String(value || '').trim()).filter(Boolean);
}

function quotationCustomerName(row) {
  return quotationCustomerReferences(row)[0] || '';
}

function quotationStatus(row) {
  const publicDocument = quotationPublicDocument(row);
  return normalize(row?.status || row?.quotation_status || publicDocument?.quotation?.status || '');
}

function quotationProjectId(row) {
  const publicDocument = quotationPublicDocument(row);
  return String(row?.project_id || row?.projectId || publicDocument?.project?.projectId || '').trim();
}

function quotationId(row) {
  const publicDocument = quotationPublicDocument(row);
  return String(row?.quotation_id || row?.quotationId || row?.id || publicDocument?.quotation?.quotationId || '').trim();
}

function quotationNumber(row) {
  const publicDocument = quotationPublicDocument(row);
  return String(row?.quotation_number || row?.quotationNumber || publicDocument?.quotation?.quotationNumber || '').trim();
}

function quotationPublicUrl(row) {
  const publicDocument = quotationPublicDocument(row);
  return String(row?.public_url || row?.publicUrl || publicDocument?.quotation?.publicUrl || '').trim();
}

function quotationCreatedAt(row) {
  return String(row?.created_at || row?.createdAt || '').trim();
}
function quotationTotalUsd(row) {
  const publicDocument = quotationPublicDocument(row);
  const raw =
    row?.total_usd ??
    row?.totalUsd ??
    publicDocument?.pricing?.totalUsd ??
    publicDocument?.totals?.totalUsd ??
    null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function quotationPrimaryItem(row) {
  const publicDocument = quotationPublicDocument(row);
  const items = Array.isArray(row?.items)
    ? row.items
    : Array.isArray(publicDocument?.items)
      ? publicDocument.items
      : [];
  const first = items.find(Boolean);
  return String(first?.title || first?.description || first?.name || '').trim();
}

function formatQuotationReadRow(row) {
  const number = quotationNumber(row) || quotationId(row) || 'sin número';
  const customer = quotationCustomerName(row) || 'cliente sin nombre';
  const status = quotationStatus(row) || 'sin estado';
  const createdAt = quotationCreatedAt(row) || 'sin fecha';
  const total = quotationTotalUsd(row);
  const item = quotationPrimaryItem(row);
  const url = quotationPublicUrl(row);

  return [
    `Cotización: ${number}`,
    `Cliente: ${customer}`,
    item ? `Trabajo: ${item}` : '',
    total === null ? '' : `Total: USD ${total.toFixed(2)}`,
    `Estado: ${status}`,
    `Creada: ${createdAt}`,
    url ? `Enlace: ${url}` : ''
  ].filter(Boolean).join('\n');
}


function filterQuotationsByCustomerReference(payload, reference) {
  const wanted = normalize(reference);
  if (!wanted) return [];

  return quotationRows(payload).filter(row =>
    quotationCustomerReferences(row).some(value => {
      const candidate = normalize(value);
      return candidate && (candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate));
    })
  );
}

function selectQuotationByCustomerReference(payload, reference) {
  const wanted = normalize(reference);
  if (!wanted) return { status: 'not_found', candidates: [] };

  const matches = filterQuotationsByCustomerReference(payload, reference);

  if (!matches.length) return { status: 'not_found', candidates: [] };

  const exact = matches.filter(row =>
    quotationCustomerReferences(row).some(value => normalize(value) === wanted)
  );
  const scoped = exact.length ? exact : matches;
  const drafts = scoped.filter(row => quotationStatus(row) === 'draft');

  if (drafts.length === 1) return { status: 'selected', row: drafts[0], candidates: scoped };
  if (drafts.length > 1) return { status: 'ambiguous', candidates: drafts };
  if (scoped.length === 1) return { status: 'selected', row: scoped[0], candidates: scoped };

  return {
    status: 'ambiguous',
    candidates: [...scoped].sort((a, b) => quotationCreatedAt(b).localeCompare(quotationCreatedAt(a)))
  };
}

function formatQuotationCandidates(rows) {
  return rows.slice(0, 5).map(row => {
    const number = quotationNumber(row) || quotationId(row) || 'sin número';
    const status = quotationStatus(row) || 'sin estado';
    const name = quotationCustomerName(row) || 'cliente sin nombre';
    return `${number} — ${name} — ${status}`;
  }).join('; ');
}

function parseProviderList(message) {
  const normalized = normalize(message);
  const hasProvider = /\b(proveedor|proveedores|provedor|provedores)\b/.test(normalized);
  if (!hasProvider) return null;

  const specificSearch = normalized.match(/^(?:elan\s+)?(?:busca|buscar|encuentra|encontra|localiza)\s+(?:al\s+|el\s+|la\s+)?(?:proveedor|provedor)\s+(.+)$/);
  if (specificSearch) return null;

  const asksList = /\b(lista|listar|muestra|mostrar|dime|decime|cuales|registrados|registradas|tenemos|audita|auditar|revisa|revisar)\b/.test(normalized);
  const asksCount = /\b(cuantos|cantidad|total)\b/.test(normalized);
  const genericCollection = /\b(proveedores?\s+(?:que\s+)?tenemos|provedores?\s+(?:que\s+)?tenemos|proveedores?\s+registrados|provedores?\s+registrados|todos\s+los\s+(?:proveedores|provedores)|lista\s+(?:de\s+)?(?:proveedores|provedores))\b/.test(normalized);

  if (!asksList && !asksCount && !genericCollection) return null;

  return {
    type: BUSINESS_COMMANDS.PROVIDER_LIST,
    sort: 'alphabetical',
    countOnly: asksCount && !asksList && !genericCollection
  };
}

function parseProviderSearch(message) {
  const normalized = normalize(message);
  const match = normalized.match(/^(?:elan\s+)?(?:busca|buscar|encuentra|encontra|localiza)\s+(?:al\s+|el\s+|la\s+)?(?:proveedor|provedor)\s+(.+)$/);
  if (!match) return null;
  return { type: BUSINESS_COMMANDS.PROVIDER_SEARCH, query: match[1].trim() };
}

function parseProviderQuoteRequest(message) {
  const normalized = normalize(message)
    .replace(/^elan[\s,;:]+/, '')
    .replace(/[.!?]+$/g, '')
    .trim();

  const directMessageMatch = normalized.match(
    /^(?:escribe|escribile|escribeles|envia|enviale|manda|mandale|contacta|contactale)\s+(?:al\s+)?(?:proveedor|provedor)\s+(.+?)\s+(?:y\s+)?(?:pregunta|preguntale|consulta|consultale)\s+(?:por|sobre)\s+(.+)$/
  );
  if (directMessageMatch) {
    const providerName = directMessageMatch[1].trim();
    const item = directMessageMatch[2].trim();
    if (!providerName || !item) return null;
    return {
      type: BUSINESS_COMMANDS.PROVIDER_QUOTE_REQUEST,
      providerName,
      item,
      requestKind: 'status'
    };
  }

  const match = normalized.match(
    /^(?:pedi|pedile|pide|pidale|solicita|solicitale|consulta|consultale|cotiza|cotizale)\s+(?:el\s+)?(?:precio|cotizacion)\s+(?:a|al)\s+(.+?)\s+(?:de|por|para)\s+(?:(?:un|una|el|la)\s+)?(.+)$/
  );
  if (!match) return null;

  const providerName = match[1].trim();
  const item = match[2].trim();
  if (!providerName || !item) return null;

  return {
    type: BUSINESS_COMMANDS.PROVIDER_QUOTE_REQUEST,
    providerName,
    item,
    requestKind: 'quote'
  };
}

function parseCurrencyAmount(rawValue, currencyWord = '') {
  const amount = Number(String(rawValue || '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) return null;
  const normalizedCurrency = normalize(currencyWord);
  const currency = /(cordoba|nio)/.test(normalizedCurrency) ? 'NIO' : 'USD';
  return { amount, currency };
}

function parseMoney(message) {
  const raw = String(message || '');
  const match = raw.match(/(?:por|precio(?:\s+de)?|a)\s*(us\$|usd|c\$|nio|\$)?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(dolares|dólares|usd|cordobas|córdobas|nio)?/i);
  if (!match) return null;
  const result = parseCurrencyAmount(match[2], match[3] || match[1]);
  if (!result || result.amount <= 0) return null;
  if (/^c\$$/i.test(match[1] || '')) result.currency = 'NIO';
  return result;
}

function parseExplicitRate(message) {
  const raw = String(message || '');
  const match = raw.match(/(?:cuesta|cobra|tarifa(?:\s+de)?|vale|es)\s*(us\$|usd|c\$|nio|\$)?\s*([0-9]+(?:[.,][0-9]{1,4})?)\s*(dolares|dólares|usd|cordobas|córdobas|nio)?/i);
  if (!match) return null;
  const result = parseCurrencyAmount(match[2], match[3] || match[1]);
  if (!result) return null;
  if (/^c\$$/i.test(match[1] || '')) result.currency = 'NIO';
  return result;
}

function parseDimensions(message) {
  const match = normalize(message).match(/\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\b/);
  if (!match) return {};
  return { width: Number(match[1].replace(',', '.')), height: Number(match[2].replace(',', '.')) };
}

function parseSellerName(message) {
  const raw = String(message || '');
  const stop = '(?=\\s+por\\s+(?:un|una)|\\s+para\\s+(?:un|una)|,|$)';
  const roleMatch = raw.match(new RegExp(`(?:para\\s+)?(?:la\\s+|el\\s+)?(?:vendedora|vendedor)\\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ ]{0,60}?)${stop}`, 'i'));
  if (roleMatch) return roleMatch[1].trim();
  const fallback = raw.match(new RegExp(`\\bpara\\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ ]{0,60}?)${stop}`, 'i'));
  return fallback ? fallback[1].trim() : '';
}

function parsePriceAuthorization(message) {
  const normalized = normalize(message);
  if (!/\b(apruebo|autoriza|autorizo|aprobar)\b/.test(normalized) || !/\bprecio\b/.test(normalized)) return null;
  const sellerId = parseSellerName(message);
  const money = parseMoney(message);
  if (!sellerId || !money) return null;
  const dimensions = parseDimensions(message);
  const destinationMatch = String(message || '').match(/\b(?:instalado|instalada|entregado|entregada|delivery|instalacion|instalación)\s+en\s+([^,.\n]+?)(?=\s+por\s+(?:us\$|usd|c\$|nio|\$)?\s*\d|[,.\n]|$)/i);
  const productMatch = String(message || '').match(/\bpor\s+(?:un|una)\s+(.+?)(?=\s+(?:instalado|instalada|entregado|entregada|delivery)\s+en\b|\s+por\s+(?:us\$|usd|c\$|nio|\$)?\s*\d|[,.\n]|$)/i);
  const productDescription = (productMatch?.[1] || '').trim();
  if (!productDescription) return null;
  return {
    type: BUSINESS_COMMANDS.PRICE_AUTH_CREATE,
    authorization: {
      sellerId,
      productDescription,
      ...dimensions,
      ...(destinationMatch?.[1] ? { destination: destinationMatch[1].trim() } : {}),
      price: money.amount,
      currency: money.currency,
      metadata: { requestedFromNaturalLanguage: true }
    }
  };
}

function parseLogisticsRule(message) {
  const raw = String(message || '').trim();
  const normalized = normalize(raw);
  if (!/\b(guarda|guardar|registra|registrar|anota|aprende|actualiza)\b/.test(normalized)) return null;
  const rate = parseExplicitRate(raw);
  if (!rate) return null;

  const carrierMatch = raw.match(/(?:que\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ ]{1,50}?)\s+(?:cobra|cuesta|tiene\s+tarifa)/i);
  const routeMatch = raw.match(/\bde\s+([A-Za-zÁÉÍÓÚÑáéíóúñ ]+?)\s+a\s+([A-Za-zÁÉÍÓÚÑáéíóúñ ]+?)(?=[,.]|\s+(?:cuesta|cobra|por|a)\s*(?:us\$|usd|c\$|nio|\$)?\s*\d|$)/i);
  const deliveryMatch = raw.match(/\bdelivery\s+(?:dentro\s+de|en|para)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ ]+?)(?=\s+(?:cuesta|cobra|vale|es)\b|[,.]|$)/i);
  const perKm = /\b(?:por|cada)\s*(?:km|kilometro|kilómetro)s?\b|\bpor\s+km\b/i.test(raw);

  if (carrierMatch && routeMatch) {
    return {
      type: BUSINESS_COMMANDS.LOGISTICS_RULE_CREATE,
      rule: {
        provider: carrierMatch[1].replace(/^(?:elan\s+)?(?:guarda|guardar|registra|registrar|anota|aprende|actualiza)\s+(?:que\s+)?/i, '').trim(),
        serviceType: 'carrier',
        origin: routeMatch[1].trim(),
        destination: routeMatch[2].trim(),
        pricingUnit: perKm ? 'per_km' : 'flat',
        rate: rate.amount,
        currency: rate.currency,
        metadata: { requestedFromNaturalLanguage: true }
      }
    };
  }

  if (deliveryMatch) {
    return {
      type: BUSINESS_COMMANDS.LOGISTICS_RULE_CREATE,
      rule: {
        serviceType: 'delivery',
        destination: deliveryMatch[1].trim(),
        pricingUnit: perKm ? 'per_km' : 'flat',
        rate: rate.amount,
        currency: rate.currency,
        metadata: { requestedFromNaturalLanguage: true }
      }
    };
  }

  if (perKm) {
    return {
      type: BUSINESS_COMMANDS.LOGISTICS_RULE_CREATE,
      rule: {
        serviceType: 'distance',
        pricingUnit: 'per_km',
        rate: rate.amount,
        currency: rate.currency,
        metadata: { requestedFromNaturalLanguage: true }
      }
    };
  }

  return null;
}

function detectOwnerBusinessCommand(message) {
  if (isProviderServiceRegistrationRequest(message)) {
    return {
      type: BUSINESS_COMMANDS.PROVIDER_SERVICE_REGISTER,
      message: String(message || '').trim()
    };
  }

  const quotationSplitSend = parseQuotationSplitSend(message);
  if (quotationSplitSend) return quotationSplitSend;
  const quotationCustomerList = parseQuotationCustomerList(message);
  if (quotationCustomerList) return quotationCustomerList;
  const quotationRead = parseQuotationReadRequest(message);
  if (quotationRead) return quotationRead;
  const quotationLookupSend = parseQuotationLookupSend(message);
  if (quotationLookupSend) return quotationLookupSend;
  const quotationLookup = parseQuotationLookup(message);
  if (quotationLookup) return quotationLookup;
  const quotation = parseQuotationRequest(message);
  if (quotation) return { type: BUSINESS_COMMANDS.QUOTATION_CREATE, input: quotation };
  return parseCustomerCreate(message)
    || parseCustomerList(message)
    || parseCustomerSearch(message)
    || parseProviderQuoteRequest(message)
    || parseProviderList(message)
    || parseProviderSearch(message)
    || parsePriceAuthorization(message)
    || parseLogisticsRule(message)
    || null;
}

function formatCustomer(customer, idempotent = false) {
  return [
    idempotent ? '✅ El cliente ya existía en CONNECT; reutilicé el registro oficial.' : '✅ Cliente creado en el sistema oficial.',
    '',
    `Cliente: ${customer.name || customer.companyName || 'Sin nombre'}`,
    customer.companyName && customer.companyName !== customer.name ? `Empresa: ${customer.companyName}` : '',
    customer.phone ? `WhatsApp: ${customer.phone}` : '',
    customer.address ? `Dirección: ${customer.address}` : '',
    `ID oficial: ${customer.customerId || customer.id}`
  ].filter(Boolean).join('\n');
}

function customerDisplayName(customer) {
  return String(customer?.name || customer?.companyName || customer?.displayName || 'Sin nombre').trim();
}

function formatCustomerList(result, countOnly = false) {
  const rawRows = Array.isArray(result?.data?.results) ? result.data.results : [];
  const customers = rawRows
    .map(row => row?.customer || row)
    .filter(Boolean)
    .sort((a, b) => customerDisplayName(a).localeCompare(customerDisplayName(b), 'es', { sensitivity: 'base' }));

  const count = Number(result?.data?.count ?? customers.length);
  const capped = count >= 100 && customers.length >= 100;
  const header = capped ? `Clientes oficiales encontrados: ${count}+` : `Clientes oficiales registrados: ${count}`;

  if (countOnly) return header;
  if (!customers.length) return 'No hay clientes oficiales registrados en CONNECT.';

  const lines = customers.map((customer, index) => {
    const name = customerDisplayName(customer);
    const company = customer.companyName && customer.companyName !== name ? ` — ${customer.companyName}` : '';
    return `${index + 1}. ${name}${company}`;
  });

  return [header, '', 'Orden alfabético:', '', ...lines].join('\n');
}

function providerDisplayName(provider) {
  return String(provider?.tradeName || provider?.legalName || 'Sin nombre').trim();
}

function providerRows(result) {
  return (Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : []).filter(Boolean);
}

function formatProvider(provider, index = null) {
  const prefix = index === null ? '' : `${index}. `;
  const categories = Array.isArray(provider?.categories) && provider.categories.length ? provider.categories.join(', ') : 'Sin clasificar';
  const specialties = Array.isArray(provider?.specialties) && provider.specialties.length ? provider.specialties.join(', ') : 'Sin registrar';
  const platforms = Array.isArray(provider?.platforms) && provider.platforms.length ? provider.platforms.join(', ') : 'Sin plataforma';
  return [
    `${prefix}${providerDisplayName(provider)}`,
    `   Contacto: ${provider?.contactName || 'No registrado'}`,
    `   WhatsApp: ${provider?.whatsapp || 'No registrado'}`,
    `   Teléfono: ${provider?.phone || 'No registrado'}`,
    `   Correo: ${provider?.email || 'No registrado'}`,
    `   Categorías: ${categories}`,
    `   Especialidades: ${specialties}`,
    `   Plataformas: ${platforms}`,
    `   Estado: ${provider?.status || 'sin estado'}`
  ].join('\n');
}

function formatProviderList(result, countOnly = false) {
  const providers = providerRows(result)
    .sort((a, b) => providerDisplayName(a).localeCompare(providerDisplayName(b), 'es', { sensitivity: 'base' }));

  const header = `Proveedores oficiales registrados: ${providers.length}`;
  if (countOnly) return header;
  if (!providers.length) return 'No hay proveedores oficiales activos registrados en CONNECT.';
  return [header, '', ...providers.map((provider, index) => formatProvider(provider, index + 1))].join('\n\n');
}

function buildProviderQuoteMessage(item, requestKind = 'quote') {
  if (requestKind === 'status') {
    return [
      'Hola, buen día.',
      '',
      `Quisiera consultar por ${item}. ¿Podrían confirmarnos el estado y cuándo estaría listo para revisión o entrega?`,
      '',
      'Gracias.'
    ].join('\n');
  }

  return [
    'Hola, buen día. Somos ELANKAV.',
    '',
    `¿Nos podría compartir precio de ${item}?`,
    'Por favor indicar presentación o medida disponible, existencia, si el precio incluye IVA y tiempo de entrega.',
    '',
    'Gracias.'
  ].join('\n');
}

function chooseProvider(rows, requestedName) {
  const wanted = normalize(requestedName);
  const exact = rows.filter(provider => {
    const names = [provider?.tradeName, provider?.legalName].filter(Boolean).map(normalize);
    return names.includes(wanted);
  });
  if (exact.length === 1) return exact[0];
  if (!exact.length && rows.length === 1) return rows[0];
  return null;
}

function formatLogisticsRule(rule) {
  return [
    '✅ Regla logística registrada en CONNECT.',
    '',
    `Regla: ${rule.ruleCode || rule.id}`,
    rule.provider ? `Proveedor: ${rule.provider}` : '',
    `Tipo: ${rule.serviceType}`,
    rule.origin ? `Origen: ${rule.origin}` : '',
    rule.destination ? `Destino: ${rule.destination}` : '',
    `Tarifa: ${rule.currency} ${Number(rule.rate || 0).toFixed(2)} ${rule.pricingUnit}`
  ].filter(Boolean).join('\n');
}

async function executeOwnerBusinessCommand(command) {
  if (command.type === BUSINESS_COMMANDS.PROVIDER_SERVICE_REGISTER) {
    const registration = await processOwnerProviderServiceRegistration({
      message: command.message
    });

    return {
      handled: registration.handled === true,
      outputText: registration.outputText || null,
      result: registration.result || null
    };
  }

  if (command.type === BUSINESS_COMMANDS.QUOTATION_CUSTOMER_LIST) {
    const payload = await listQuotations();
    const rows = filterQuotationsByCustomerReference(payload, command.customerReference)
      .slice()
      .sort((a, b) => quotationCreatedAt(b).localeCompare(quotationCreatedAt(a)));

    if (!rows.length) {
      return {
        handled: true,
        outputText: `No encontré cotizaciones oficiales asociadas al cliente “${command.customerReference}”.`,
        result: { status: 'not_found', rows: [] }
      };
    }

    await updateContext({
      activeQuotationId: null,
      activeQuotationNumber: null,
      activeQuotationPublicUrl: null,
      activeProjectId: null,
      lastEntityType: 'quotation_customer_list',
      lastEntityId: String(command.customerReference || '').trim(),
      activeCustomerReference: quotationCustomerName(rows[0]) || String(command.customerReference || '').trim(),
      lastIntent: 'quotation_list_by_customer',
      lastQuotationCustomerReference: quotationCustomerName(rows[0]) || String(command.customerReference || '').trim(),
      lastQuotationIds: rows.map(quotationId).filter(Boolean),
      lastQuotationNumbers: rows.map(quotationNumber).filter(Boolean),
      lastQuotationProjectIds: rows.map(quotationProjectId).filter(Boolean),
      lastQuotationListAt: new Date().toISOString()
    });

    return {
      handled: true,
      outputText: [
        `Cotizaciones de ${quotationCustomerName(rows[0]) || command.customerReference}: ${rows.length}`,
        '',
        ...rows.flatMap((row, index) => [
          `${index + 1}. ${formatQuotationReadRow(row).replace(/\n/g, '\n   ')}`,
          ''
        ])
      ].join('\n').trim(),
      result: { status: 'found', rows }
    };
  }

  if (command.type === BUSINESS_COMMANDS.QUOTATION_SPLIT_SEND) {
    const context = await readContext();
    const payload = await listQuotations();
    const rows = quotationRows(payload);

    let splitGroupId = String(context.lastSplitGroupId || '').trim() || (
      context.lastEntityType === 'quotation_split'
        ? String(context.lastEntityId || '').trim()
        : ''
    );

    let candidates = splitGroupId
      ? rows.filter(row => String(quotationRelations(row)?.splitGroupId || '').trim() === splitGroupId)
      : [];

    if (command.customerReference) {
      const wanted = normalize(command.customerReference);
      const matchesCustomer = row => quotationCustomerReferences(row).some(value => {
        const candidate = normalize(value);
        return candidate && (candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate));
      });

      if (candidates.length && !candidates.every(matchesCustomer)) {
        return {
          handled: true,
          outputText: `El último grupo dividido no corresponde de forma segura al cliente “${command.customerReference}”. No preparé ningún envío.`,
          result: { status: 'customer_mismatch', candidates }
        };
      }

      if (!candidates.length) {
        const grouped = new Map();
        for (const row of rows.filter(matchesCustomer)) {
          const groupId = String(quotationRelations(row)?.splitGroupId || '').trim();
          if (!groupId) continue;
          if (!grouped.has(groupId)) grouped.set(groupId, []);
          grouped.get(groupId).push(row);
        }

        const validGroups = [...grouped.entries()].filter(([, groupRows]) =>
          groupRows.length === Number(command.expectedCount || 2) &&
          groupRows.every(row => quotationStatus(row) === 'draft')
        );

        if (validGroups.length === 1) {
          splitGroupId = validGroups[0][0];
          candidates = validGroups[0][1];
        } else if (validGroups.length > 1) {
          return {
            handled: true,
            outputText: `Encontré más de un grupo de alternativas en borrador para “${command.customerReference}”. No preparé ningún envío para evitar mezclar cotizaciones.`,
            result: { status: 'ambiguous_split_groups', groups: validGroups.map(([id]) => id) }
          };
        }
      }

      if (!candidates.length) {
        const titleGroups = new Map();
        for (const row of rows.filter(matchesCustomer)) {
          if (quotationStatus(row) !== 'draft') continue;
          const metadata = quotationSplitTitleMetadata(row);
          if (!metadata) continue;
          const key = normalize(metadata.baseTitle);
          if (!key) continue;
          if (!titleGroups.has(key)) titleGroups.set(key, []);
          titleGroups.get(key).push({ row, metadata });
        }

        const expectedCount = Number(command.expectedCount || 0);
        const validTitleGroups = [...titleGroups.entries()].filter(([, entries]) => {
          if (entries.length < 2) return false;
          if (expectedCount && entries.length !== expectedCount) return false;
          const indexes = entries.map(entry => entry.metadata.partIndex).sort((a, b) => a - b);
          return indexes.every((value, index) => value === index + 1);
        });

        if (validTitleGroups.length === 1) {
          const [baseKey, entries] = validTitleGroups[0];
          splitGroupId = `title:${baseKey}`;
          candidates = entries.map(entry => entry.row);
        } else if (validTitleGroups.length > 1) {
          return {
            handled: true,
            outputText: `Encontré más de un par de alternativas en borrador para “${command.customerReference}”. No preparé ningún envío para evitar mezclar proyectos.`,
            result: {
              status: 'ambiguous_split_title_groups',
              groups: validTitleGroups.map(([key]) => key)
            }
          };
        }
      }
    }

    if (!candidates.length && (context.lastSplitGroupId || context.lastEntityType === 'quotation_split')) {
      const titleGroups = new Map();
      for (const row of rows) {
        if (quotationStatus(row) !== 'draft') continue;
        const metadata = quotationSplitTitleMetadata(row);
        if (!metadata) continue;
        const key = normalize(metadata.baseTitle);
        if (!key) continue;
        if (!titleGroups.has(key)) titleGroups.set(key, []);
        titleGroups.get(key).push({ row, metadata });
      }

      const requestedCount = Number(command.expectedCount || 0);
      const validGroups = [...titleGroups.entries()].filter(([, entries]) => {
        if (entries.length < 2) return false;
        if (requestedCount && entries.length !== requestedCount) return false;
        const indexes = entries.map(entry => entry.metadata.partIndex).sort((a, b) => a - b);
        return indexes.every((value, index) => value === index + 1);
      });

      if (validGroups.length === 1) {
        splitGroupId = `title:${validGroups[0][0]}`;
        candidates = validGroups[0][1].map(entry => entry.row);
      }
    }

    if (!candidates.length) {
      return {
        handled: true,
        outputText: 'No pude identificar con seguridad qué grupo de cotizaciones querés enviar. No envié nada. Podés decirme el cliente o los números de cotización.',
        result: { status: 'split_group_not_found' }
      };
    }

    const expectedCount = Number(command.expectedCount || candidates.length);
    const sorted = [...candidates].sort((a, b) => {
      const aIndex = Number(
        quotationRelations(a)?.splitPartIndex ||
        quotationSplitTitleMetadata(a)?.partIndex ||
        0
      );
      const bIndex = Number(
        quotationRelations(b)?.splitPartIndex ||
        quotationSplitTitleMetadata(b)?.partIndex ||
        0
      );
      return aIndex - bIndex || quotationCreatedAt(a).localeCompare(quotationCreatedAt(b));
    });

    if (sorted.length !== expectedCount) {
      return {
        handled: true,
        outputText: `El grupo dividido tiene ${sorted.length} cotizaciones y la orden pide ${expectedCount}. No preparé ningún envío.`,
        result: { status: 'split_count_mismatch', candidates: sorted }
      };
    }

    const nonDraft = sorted.filter(row => quotationStatus(row) !== 'draft');
    if (nonDraft.length) {
      return {
        handled: true,
        outputText: `No preparé el envío porque una o más alternativas ya no están en borrador: ${formatQuotationCandidates(nonDraft)}.`,
        result: { status: 'split_not_draft', candidates: sorted }
      };
    }

    const prepared = [];
    for (const row of sorted) {
      const projectId = quotationProjectId(row);
      const qId = quotationId(row);
      const qNumber = quotationNumber(row);
      const publicUrl = quotationPublicUrl(row);

      if (!projectId || !qId) {
        return {
          handled: true,
          outputText: 'Una de las alternativas no tiene proyecto o identificador oficial resoluble. No preparé los envíos.',
          result: { status: 'split_identifier_missing', candidates: sorted }
        };
      }

      const operation = await createPendingOperation({
        capability: 'business.quotation.send-whatsapp',
        target: 'connect',
        requestedBy: 'owner-whatsapp',
        summary: `Enviar ${qNumber || qId} al cliente por WhatsApp`,
        impact: 'Envía externamente una de las alternativas oficiales. Requiere confirmación explícita del Owner.',
        parameters: {
          projectId,
          quotationId: qId
        }
      });

      prepared.push({
        operation,
        quotation: {
          projectId,
          quotationId: qId,
          quotationNumber: qNumber || null,
          publicUrl: publicUrl || null,
          customerName: quotationCustomerName(row) || command.customerReference || null
        }
      });
    }

    return {
      handled: true,
      outputText: [
        `Preparé ${prepared.length} envíos independientes para las alternativas del cliente.`,
        'Cada cotización conserva su propia confirmación y trazabilidad.',
        '',
        ...prepared.flatMap((entry, index) => [
          `Alternativa ${index + 1}: ${entry.quotation.quotationNumber || entry.quotation.quotationId}`,
          formatPendingOperation(entry.operation),
          ''
        ])
      ].join('\n').trim(),
      result: { status: 'prepared', splitGroupId, prepared }
    };
  }

  if (
    command.type === BUSINESS_COMMANDS.QUOTATION_LATEST ||
    command.type === BUSINESS_COMMANDS.QUOTATION_RECENT
  ) {
    const payload = await listQuotations();
    const rows = quotationRows(payload)
      .slice()
      .sort((a, b) => quotationCreatedAt(b).localeCompare(quotationCreatedAt(a)));

    if (!rows.length) {
      return {
        handled: true,
        outputText: 'No encontré cotizaciones oficiales registradas en CONNECT/VQS.',
        result: { rows: [] }
      };
    }

    const limit = command.type === BUSINESS_COMMANDS.QUOTATION_LATEST
      ? 1
      : Math.max(1, Math.min(Number(command.limit) || 5, 10));
    const selected = rows.slice(0, limit);

    return {
      handled: true,
      outputText: command.type === BUSINESS_COMMANDS.QUOTATION_LATEST
        ? ['Última cotización oficial registrada:', '', formatQuotationReadRow(selected[0])].join('\n')
        : [
            `Últimas ${selected.length} cotizaciones oficiales registradas:`,
            '',
            ...selected.flatMap((row, index) => [`${index + 1}. ${formatQuotationReadRow(row).replace(/\n/g, '\n   ')}`, ''])
          ].join('\n').trim(),
      result: { rows: selected }
    };
  }

  if (command.type === BUSINESS_COMMANDS.QUOTATION_LOOKUP) {
    const quotations = await listQuotations();
    const resolved = selectQuotationByCustomerReference(quotations, command.customerReference);

    if (resolved.status === 'not_found') {
      return {
        handled: true,
        outputText: `No encontré una cotización oficial asociada al cliente “${command.customerReference}”.`,
        result: resolved
      };
    }

    if (resolved.status === 'ambiguous') {
      return {
        handled: true,
        outputText: `Encontré varias cotizaciones para “${command.customerReference}”: ${formatQuotationCandidates(resolved.candidates)}.`,
        result: resolved
      };
    }

    const row = resolved.row || {};
    const projectId = quotationProjectId(row);
    const qId = quotationId(row);
    const qNumber = quotationNumber(row);
    const publicUrl = quotationPublicUrl(row);

    if (projectId && qId) {
      await updateContext({
        activeProjectId: projectId,
        activeQuotationId: qId,
        activeQuotationNumber: qNumber || null,
        activeQuotationPublicUrl: publicUrl || null,
        lastEntityType: 'quotation',
        lastEntityId: qId,
        activeCustomerReference: quotationCustomerName(row) || command.customerReference || null,
        lastIntent: 'quotation_lookup',
        lastQuotationCustomerReference: quotationCustomerName(row) || command.customerReference || null,
        lastQuotationIds: [qId],
        lastQuotationNumbers: qNumber ? [qNumber] : [],
        lastQuotationProjectIds: [projectId],
        lastQuotationListAt: new Date().toISOString()
      });
    }

    return {
      handled: true,
      outputText: ['Cotización encontrada:', '', formatQuotationReadRow(row)].join('\n'),
      result: resolved
    };
  }

  if (command.type === BUSINESS_COMMANDS.QUOTATION_LOOKUP_SEND) {
    const quotations = await listQuotations();
    const resolved = selectQuotationByCustomerReference(quotations, command.customerReference);

    if (resolved.status === 'not_found') {
      return {
        handled: true,
        outputText: `No encontré una cotización oficial asociada al cliente “${command.customerReference}”. No envié nada.`,
        result: resolved
      };
    }

    if (resolved.status === 'ambiguous') {
      return {
        handled: true,
        outputText: `Encontré varias cotizaciones para “${command.customerReference}”: ${formatQuotationCandidates(resolved.candidates)}. Decime cuál querés enviar y no enviaré nada hasta identificarla.`,
        result: resolved
      };
    }

    const row = resolved.row || {};
    const projectId = quotationProjectId(row);
    const qId = quotationId(row);
    const qNumber = quotationNumber(row);
    const publicUrl = quotationPublicUrl(row);
    if (!projectId || !qId) {
      return {
        handled: true,
        outputText: 'Encontré la cotización, pero no pude resolver de forma segura su proyecto o identificador interno. No envié nada.',
        result: resolved
      };
    }

    await updateContext({
      activeProjectId: projectId,
      activeQuotationId: qId,
      activeQuotationNumber: qNumber || null,
      activeQuotationPublicUrl: publicUrl || null,
      lastEntityType: 'quotation',
      lastEntityId: qId
    });

    const operation = await createPendingOperation({
      capability: 'business.quotation.send-whatsapp',
      target: 'connect',
      requestedBy: 'owner-whatsapp',
      summary: `Enviar ${qNumber || qId} al cliente por WhatsApp`,
      impact: 'Envía externamente la cotización oficial encontrada. Requiere confirmación explícita del Owner.',
      parameters: {
        projectId,
        quotationId: qId
      }
    });

    return {
      handled: true,
      outputText: formatPendingOperation(operation),
      result: {
        operation,
        quotation: {
          projectId,
          quotationId: qId,
          quotationNumber: qNumber || null,
          publicUrl: publicUrl || null,
          customerName: quotationCustomerName(row) || command.customerReference
        }
      }
    };
  }

  if (command.type === BUSINESS_COMMANDS.QUOTATION_CREATE) {
    const result = await prepareAndCreateQuotation(command.input);
    if (!result.ready) return { handled: true, outputText: result.question || 'Falta información para completar la cotización.', result };
    await recordAuditSafely({
      capability: 'business.quotation.create',
      target: 'connect',
      source: 'owner-whatsapp',
      success: true,
      metadata: {
        projectId: result.quotation?.projectId || null,
        quotationId: result.quotation?.quotationId || null
      }
    });
    return { handled: true, outputText: result.summary, result };
  }

  if (command.type === BUSINESS_COMMANDS.CUSTOMER_LIST) {
    const result = await listCustomers();
    return { handled: true, outputText: formatCustomerList(result, command.countOnly === true), result };
  }

  if (command.type === BUSINESS_COMMANDS.CUSTOMER_SEARCH) {
    const result = await searchCustomers(command.query);
    const rows = result?.data?.results || [];
    if (!rows.length) return { handled: true, outputText: `No encontré un cliente oficial que coincida con “${command.query}”.`, result };
    const top = rows[0].customer || rows[0];
    await updateContext({ activeCustomerId: top.customerId || top.id, lastEntityType: 'customer', lastEntityId: top.customerId || top.id });
    return { handled: true, outputText: formatCustomer(top, true), result };
  }

  if (command.type === BUSINESS_COMMANDS.PROVIDER_LIST) {
    const result = await listProviders();
    return { handled: true, outputText: formatProviderList(result, command.countOnly === true), result };
  }

  if (command.type === BUSINESS_COMMANDS.PROVIDER_SEARCH) {
    const result = await searchProviders(command.query);
    const rows = providerRows(result);
    if (!rows.length) return { handled: true, outputText: `No encontré un proveedor oficial que coincida con “${command.query}”.`, result };
    return { handled: true, outputText: formatProvider(rows[0]), result };
  }

  if (command.type === BUSINESS_COMMANDS.PROVIDER_QUOTE_REQUEST) {
    const result = await searchProviders(command.providerName);
    const rows = providerRows(result);
    if (!rows.length) {
      return {
        handled: true,
        outputText: `No encontré a ${command.providerName} entre los proveedores oficiales activos. No envié ningún mensaje.`,
        result
      };
    }

    const provider = chooseProvider(rows, command.providerName);
    if (!provider) {
      const names = rows.slice(0, 5).map(providerDisplayName).join(', ');
      return {
        handled: true,
        outputText: `Encontré más de un proveedor que coincide con “${command.providerName}”: ${names}. Decime cuál querés y no enviaré nada hasta identificarlo.`,
        result
      };
    }

    const phone = normalizePhone(provider.whatsapp || provider.phone);
    if (!phone) {
      return {
        handled: true,
        outputText: `${providerDisplayName(provider)} está registrado, pero no tiene un WhatsApp válido. No envié ningún mensaje.`,
        result
      };
    }

    const message = buildProviderQuoteMessage(command.item, command.requestKind || 'quote');
    const delivery = createWahaDeliveryAdapter();
    const sent = await delivery.sendText({ phone, text: message });

    await recordAuditSafely({
      capability: command.requestKind === 'status' ? 'business.provider.message.send' : 'business.provider.quote-request.send',
      target: 'waha',
      source: 'owner-whatsapp',
      success: true,
      metadata: {
        providerId: provider.id || provider.providerId || null,
        provider: providerDisplayName(provider),
        item: command.item,
        requestKind: command.requestKind || 'quote',
        phone,
        chatId: sent.chatId || null,
        messageId: sent.messageId || null
      }
    });

    return {
      handled: true,
      outputText: [
        command.requestKind === 'status' ? '✅ Mensaje enviado al proveedor.' : '✅ Solicitud enviada al proveedor.',
        '',
        `Proveedor: ${providerDisplayName(provider)}`,
        command.requestKind === 'status' ? `Asunto: ${command.item}` : `Producto/servicio: ${command.item}`,
        `WhatsApp: ${provider.whatsapp || phone}`,
        sent.messageId ? `Mensaje: ${sent.messageId}` : ''
      ].filter(Boolean).join('\n'),
      result: { provider, sent, item: command.item, requestKind: command.requestKind || 'quote' }
    };
  }

  if (command.type === BUSINESS_COMMANDS.CUSTOMER_CREATE) {
    const result = await createCustomer(command.input);
    const customer = result.data || result;
    await updateContext({ activeCustomerId: customer.customerId || customer.id, lastEntityType: 'customer', lastEntityId: customer.customerId || customer.id });
    await recordAuditSafely({
      capability: 'business.customer.create',
      target: 'connect',
      source: 'owner-whatsapp',
      success: true,
      metadata: { customerId: customer.customerId || customer.id }
    });
    return { handled: true, outputText: formatCustomer(customer, Boolean(result.idempotent)), result };
  }

  if (command.type === BUSINESS_COMMANDS.LOGISTICS_RULE_CREATE) {
    const result = await createLogisticsRule(command.rule);
    const rule = result.data || result;
    await recordAuditSafely({
      capability: 'business.logistics.rule.write',
      target: 'connect',
      source: 'owner-whatsapp',
      success: true,
      metadata: { ruleId: rule.id || null, ruleCode: rule.ruleCode || null }
    });
    return { handled: true, outputText: formatLogisticsRule(rule), result };
  }

  if (command.type === BUSINESS_COMMANDS.PRICE_AUTH_CREATE) {
    const operation = await createPendingOperation({
      capability: 'business.price-authorization.create',
      target: 'connect',
      requestedBy: 'owner-whatsapp',
      summary: `Autorizar precio ${command.authorization.currency} ${Number(command.authorization.price).toFixed(2)} para ${command.authorization.sellerId}`,
      impact: 'Crea una excepción comercial oficial que el vendedor podrá usar únicamente cuando la cotización coincida con su alcance.',
      parameters: { authorization: command.authorization }
    });
    return { handled: true, outputText: formatPendingOperation(operation), result: operation };
  }

  return { handled: false, outputText: null, result: null };
}

module.exports = {
  BUSINESS_COMMANDS,
  buildProviderQuoteMessage,
  chooseProvider,
  detectOwnerBusinessCommand,
  executeOwnerBusinessCommand,
  filterQuotationsByCustomerReference,
  formatCustomerList,
  formatProvider,
  formatProviderList,
  labeledValue,
  parseCustomerCreate,
  parseCustomerList,
  parseCustomerSearch,
  parseDimensions,
  parseExplicitRate,
  parseLogisticsRule,
  parseMoney,
  parsePriceAuthorization,
  parseProviderList,
  parseProviderQuoteRequest,
  parseProviderSearch,
  parseQuotationCustomerList,
  parseQuotationLookup,
  parseQuotationLookupSend,
  parseQuotationReadRequest,
  parseQuotationSplitSend,
  quotationSplitTitleMetadata,
  parseSellerName,
  selectQuotationByCustomerReference
};
