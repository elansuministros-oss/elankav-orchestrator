'use strict';

const { createCustomer, createLogisticsRule, listCustomers, searchCustomers } = require('./ownerBusinessConnectClient');
const { updateContext } = require('./ownerBusinessContextService');
const { createPendingOperation, formatPendingOperation } = require('./ownerOpsConfirmationService');
const { recordAuditSafely } = require('./ownerOpsAuditService');
const { parseQuotationRequest, prepareAndCreateQuotation } = require('./ownerQuotationService');

const BUSINESS_COMMANDS = Object.freeze({
  CUSTOMER_CREATE: 'business_customer_create',
  CUSTOMER_SEARCH: 'business_customer_search',
  CUSTOMER_LIST: 'business_customer_list',
  PRICE_AUTH_CREATE: 'business_price_authorization_create',
  LOGISTICS_RULE_CREATE: 'business_logistics_rule_create',
  QUOTATION_CREATE: 'business_quotation_create'
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
  const quotation = parseQuotationRequest(message);
  if (quotation) return { type: BUSINESS_COMMANDS.QUOTATION_CREATE, input: quotation };
  return parseCustomerCreate(message) || parseCustomerList(message) || parseCustomerSearch(message) || parsePriceAuthorization(message) || parseLogisticsRule(message) || null;
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
  detectOwnerBusinessCommand,
  executeOwnerBusinessCommand,
  formatCustomerList,
  labeledValue,
  parseCustomerCreate,
  parseCustomerList,
  parseCustomerSearch,
  parseDimensions,
  parseExplicitRate,
  parseLogisticsRule,
  parseMoney,
  parsePriceAuthorization,
  parseSellerName
};
