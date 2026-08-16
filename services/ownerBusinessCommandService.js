'use strict';

const { randomUUID } = require('node:crypto');
const { createCustomer, searchCustomers } = require('./ownerBusinessConnectClient');
const { updateContext } = require('./ownerBusinessContextService');
const { createPendingOperation, formatPendingOperation } = require('./ownerOpsConfirmationService');
const { recordAuditSafely } = require('./ownerOpsAuditService');

const BUSINESS_COMMANDS = Object.freeze({
  CUSTOMER_CREATE: 'business_customer_create',
  CUSTOMER_SEARCH: 'business_customer_search',
  PRICE_AUTH_CREATE: 'business_price_authorization_create'
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

function parseCustomerSearch(message) {
  const normalized = normalize(message);
  const match = normalized.match(/^(?:elan\s+)?(?:busca|buscar|encuentra|encontra|localiza)\s+(?:al\s+|el\s+|la\s+)?cliente\s+(.+)$/);
  if (!match) return null;
  return { type: BUSINESS_COMMANDS.CUSTOMER_SEARCH, query: match[1].trim() };
}

function parseMoney(message) {
  const raw = String(message || '');
  const match = raw.match(/(?:por|precio(?:\s+de)?|a)\s*(?:us\$|usd|c\$|nio|\$)?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(dolares|dólares|usd|cordobas|córdobas|nio)?/i);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currencyWord = normalize(match[2] || '');
  const currency = /(cordoba|nio)/.test(currencyWord) || /c\$\s*[0-9]/i.test(raw) ? 'NIO' : 'USD';
  return { amount, currency };
}

function parseDimensions(message) {
  const match = normalize(message).match(/\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\b/);
  if (!match) return {};
  return { width: Number(match[1].replace(',', '.')), height: Number(match[2].replace(',', '.')) };
}

function parsePriceAuthorization(message) {
  const normalized = normalize(message);
  if (!/\b(apruebo|autoriza|autorizo|aprobar)\b/.test(normalized) || !/\bprecio\b/.test(normalized)) return null;
  const sellerMatch = String(message || '').match(/(?:vendedora|vendedor|para)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ ]{1,60}?)(?=\s+por\s+un|\s+por\s+una|\s+para\s+un|\s+para\s+una|\s+por\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+\s+de|,|$)/i);
  const money = parseMoney(message);
  if (!sellerMatch || !money) return null;
  const sellerId = sellerMatch[1].trim();
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

function detectOwnerBusinessCommand(message) {
  return parseCustomerCreate(message) || parseCustomerSearch(message) || parsePriceAuthorization(message) || null;
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

async function executeOwnerBusinessCommand(command) {
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
  labeledValue,
  parseCustomerCreate,
  parseCustomerSearch,
  parseDimensions,
  parseMoney,
  parsePriceAuthorization
};
