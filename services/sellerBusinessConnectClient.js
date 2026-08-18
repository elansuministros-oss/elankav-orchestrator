'use strict';

class SellerBusinessConnectError extends Error {
  constructor(code, message, statusCode, details = null) {
    super(message || code || 'SELLER_BUSINESS_CONNECT_ERROR');
    this.name = 'SellerBusinessConnectError';
    this.code = code || 'SELLER_BUSINESS_CONNECT_ERROR';
    this.statusCode = statusCode || 500;
    this.details = details;
  }
}

function config(env = process.env) {
  const baseUrl = String(env.CONNECT_BASE_URL || 'https://connect.elankav.com').trim().replace(/\/+$/, '');
  const token = String(env.VQS_API_TOKEN || '').trim();
  if (!token) throw new SellerBusinessConnectError('VQS_API_TOKEN_REQUIRED', 'No está configurada la credencial interna de CONNECT.', 503);
  return { baseUrl, token };
}

function text(...values) {
  return values.map((value) => String(value ?? '').trim()).find(Boolean) || '';
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sellerIdentity(actor = {}) {
  const sellerId = text(actor?.sellerId, actor?.actorId, actor?.sub);
  if (String(actor?.role || '').trim().toLowerCase() !== 'seller' || !sellerId) {
    throw new SellerBusinessConnectError('SELLER_ID_REQUIRED', 'No se pudo resolver el vendedor.', 403);
  }
  return {
    sellerId,
    sellerName: text(actor?.sellerName, actor?.displayName, actor?.name),
    phone: text(actor?.canonicalPhone, actor?.phone)
  };
}

function actorHeaders(token, actor = {}, extra = {}) {
  const seller = sellerIdentity(actor);
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Elankav-Platform': 'ELANVISUAL',
    'X-Elankav-Actor-Type': 'seller',
    'X-Elankav-Role': 'seller',
    'X-Elankav-Seller-Id': seller.sellerId,
    'X-Elankav-Seller-Name': seller.sellerName,
    'X-Elankav-User-Id': seller.sellerId,
    'X-Elankav-Source': 'SELLER_ELAN_RUNTIME',
    ...extra
  };
}

async function requestConnect(path, actor, options = {}, env = process.env) {
  const { baseUrl, token } = config(env);
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PATCH'].includes(method)) {
    throw new SellerBusinessConnectError('CONNECT_METHOD_NOT_ALLOWED', 'Método no autorizado para vendedor.', 405);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: actorHeaders(token, actor, options.headers || {}),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const nested = payload && typeof payload.error === 'object' ? payload.error : {};
    const code = String(payload.code || nested.code || 'CONNECT_REQUEST_FAILED');
    const message = String((typeof payload.error === 'string' ? payload.error : nested.message) || payload.message || 'CONNECT rechazó la operación.');
    throw new SellerBusinessConnectError(code, message, response.status, nested.details || payload.details || null);
  }
  return payload;
}

function query(value) {
  return encodeURIComponent(String(value || '').trim());
}

function dataOf(payload) {
  return payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

function resultsOf(payload) {
  const data = dataOf(payload);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

async function createSellerCustomer(input, actor, env) {
  return requestConnect('/api/v1/business/vqs/seller/customers', actor, { method: 'POST', body: input }, env);
}

async function updateSellerCustomer(customerId, input, actor, env) {
  return requestConnect(`/api/v1/business/vqs/seller/customers/${query(customerId)}`, actor, { method: 'PATCH', body: input }, env);
}

async function listSellerCustomers(actor, search = '', env) {
  const suffix = search ? `?q=${query(search)}` : '';
  return requestConnect(`/api/v1/business/vqs/seller/customers${suffix}`, actor, {}, env);
}

async function requireOwnedCustomer(customerId, actor, env) {
  const requested = text(customerId);
  if (!requested) throw new SellerBusinessConnectError('CUSTOMER_ID_REQUIRED', 'Necesito identificar el cliente.', 400);
  const customers = resultsOf(await listSellerCustomers(actor, '', env));
  const customer = customers.find((item) => text(item?.customerId, item?.id) === requested);
  if (!customer) {
    throw new SellerBusinessConnectError('CUSTOMER_NOT_OWNED_BY_SELLER', 'Solo podés cotizar clientes asignados a tu usuario vendedor.', 403);
  }
  return customer;
}

async function resolveCatalogPricing(input, actor, env) {
  return requestConnect('/api/v1/business/vqs/pricing/resolve', actor, { method: 'POST', body: input }, env);
}

function dimensionsOf(item = {}) {
  const dimensions = object(item.dimensions);
  const measurements = object(item.measurements);
  const width = finiteNumber(item.width ?? dimensions.width ?? measurements.width, 0);
  const height = finiteNumber(item.height ?? dimensions.height ?? measurements.height, 0);
  return {
    ...(width > 0 ? { width } : {}),
    ...(height > 0 ? { height } : {})
  };
}

function priceQueryOf(item = {}) {
  return text(item.pricingQuery, item.query, item.productName, item.name, item.title, item.description, item.label);
}

async function resolveAuthorizedItems(items, actor, env) {
  if (!Array.isArray(items) || !items.length) {
    throw new SellerBusinessConnectError('QUOTATION_ITEMS_REQUIRED', 'La cotización necesita al menos un ítem.', 400);
  }

  const resolvedItems = [];
  let grandTotal = 0;
  let quotationCurrency = '';

  for (let index = 0; index < items.length; index += 1) {
    const source = object(items[index]);
    const pricingQuery = priceQueryOf(source);
    if (!pricingQuery) {
      throw new SellerBusinessConnectError('AUTHORIZED_PRICE_QUERY_REQUIRED', `El ítem ${index + 1} no tiene descripción suficiente para buscar un precio autorizado.`, 400);
    }
    const quantity = finiteNumber(source.quantity, 1) > 0 ? finiteNumber(source.quantity, 1) : 1;
    const dimensions = dimensionsOf(source);
    const resolution = dataOf(await resolveCatalogPricing({ query: pricingQuery, quantity, ...dimensions }, actor, env)) || {};
    const status = text(resolution.status).toUpperCase();

    if (status !== 'FOUND') {
      const reason = {
        MULTIPLE: 'Hay varias tarifas autorizadas posibles; necesitás precisar la variante.',
        REQUIRES_INPUT: 'Faltan medidas para resolver el precio autorizado.',
        BASE_PRICE_ONLY: 'La tarifa es DESDE y requiere una cotización final; no puede convertirse automáticamente en precio final.',
        PRICE_NOT_AVAILABLE: 'CONNECT no permite calcular automáticamente el precio para esos datos.',
        NOT_FOUND: 'No existe un precio autorizado y publicado para ese ítem.'
      }[status] || 'No fue posible resolver un precio autorizado.';
      throw new SellerBusinessConnectError(`SELLER_PRICE_${status || 'UNRESOLVED'}`, reason, 422, { index, query: pricingQuery, status });
    }

    const product = object(resolution.item);
    const calculation = object(resolution.calculation);
    const unitPrice = finiteNumber(product.unitPrice, 0);
    const subtotal = finiteNumber(calculation.subtotal, 0);
    const currency = text(calculation.currency, product.currency, 'USD').toUpperCase();
    if (unitPrice <= 0 || subtotal <= 0) {
      throw new SellerBusinessConnectError('SELLER_AUTHORIZED_PRICE_INVALID', 'CONNECT resolvió el producto pero no devolvió un importe válido.', 422, { index, query: pricingQuery });
    }
    if (quotationCurrency && quotationCurrency !== currency) {
      throw new SellerBusinessConnectError('SELLER_QUOTATION_MIXED_CURRENCY', 'Una cotización de vendedor no puede mezclar monedas.', 422);
    }
    quotationCurrency = quotationCurrency || currency;
    grandTotal = Number((grandTotal + subtotal).toFixed(2));

    resolvedItems.push({
      ...source,
      quantity,
      ...dimensions,
      unitPrice,
      price: unitPrice,
      subtotal,
      total: subtotal,
      currency,
      authorizedPrice: {
        authority: text(resolution.authority, 'CONNECT_AI_PLATFORM_PRICES'),
        source: text(resolution.source, 'AI_PLATFORM_PRICES_DIRECT'),
        code: text(product.code),
        name: text(product.name),
        matchRule: text(resolution.matchRule),
        unitPrice,
        subtotal
      }
    });
  }

  if ((quotationCurrency || 'USD') !== 'USD') {
    throw new SellerBusinessConnectError('SELLER_QUOTATION_CURRENCY_REQUIRES_OWNER', 'La cotización automática de vendedor está habilitada para tarifas autorizadas en USD.', 422);
  }

  return {
    items: resolvedItems,
    pricing: {
      currency: quotationCurrency || 'USD',
      subtotal: grandTotal,
      subtotalUsd: grandTotal,
      discount: 0,
      discountUsd: 0,
      tax: 0,
      taxUsd: 0,
      total: grandTotal,
      totalUsd: grandTotal
    }
  };
}

async function prepareBudget(items, actor, env) {
  const seller = sellerIdentity(actor);
  const resolved = await resolveAuthorizedItems(items, actor, env);
  return {
    data: {
      type: 'SELLER_BUDGET_PREVIEW',
      authority: 'CONNECT',
      seller,
      items: resolved.items,
      pricing: resolved.pricing,
      createsQuotation: false
    }
  };
}

function customerIdOf(document = {}) {
  const input = object(document);
  const relations = object(input.relations);
  const customer = object(input.customerSnapshot);
  return text(relations.customerId, customer.customerId, customer.id);
}

async function normalizeSellerQuotation(document, actor, env) {
  const seller = sellerIdentity(actor);
  const input = object(document);
  const customerId = customerIdOf(input);
  const ownedCustomer = await requireOwnedCustomer(customerId, actor, env);
  const resolved = await resolveAuthorizedItems(Array.isArray(input.items) ? input.items : [], actor, env);
  const quotation = object(input.quotation);
  const source = object(quotation.source);
  const relations = object(input.relations);
  const customer = object(input.customerSnapshot);
  const executive = object(input.executiveSnapshot);

  return {
    ...input,
    quotation: {
      ...quotation,
      source: {
        ...source,
        type: 'seller-whatsapp',
        channel: text(source.channel, 'whatsapp'),
        sellerId: seller.sellerId
      }
    },
    relations: {
      ...relations,
      customerId,
      executiveId: seller.sellerId,
      sellerId: seller.sellerId
    },
    customerSnapshot: {
      ...customer,
      customerId,
      name: text(customer.name, ownedCustomer.name, ownedCustomer.companyName),
      companyName: text(customer.companyName, ownedCustomer.companyName),
      phone: text(customer.phone, ownedCustomer.phone, ownedCustomer.whatsapp),
      email: text(customer.email, ownedCustomer.email)
    },
    executiveSnapshot: {
      ...executive,
      id: seller.sellerId,
      executiveId: seller.sellerId,
      sellerId: seller.sellerId,
      name: text(executive.name, seller.sellerName, 'Vendedor ELANVISUAL'),
      role: 'seller'
    },
    items: resolved.items,
    pricing: {
      ...object(input.pricing),
      ...resolved.pricing
    }
  };
}

async function listLogisticsRules(actor, env) {
  return requestConnect('/api/v1/business/vqs/logistics-rules', actor, {}, env);
}

async function createQuotation(document, idempotencyKey, actor, env) {
  const key = String(idempotencyKey || '').trim();
  const normalized = await normalizeSellerQuotation(document, actor, env);
  return requestConnect('/api/v1/business/vqs/quotations', actor, {
    method: 'POST',
    body: normalized,
    headers: key ? { 'Idempotency-Key': key } : {}
  }, env);
}

function sellerIdFromQuotation(record = {}) {
  const quotationDocument = object(record.quotation_document);
  const publicDocument = object(quotationDocument.publicDocument);
  const advisor = object(publicDocument.advisor);
  return text(advisor.sellerId, advisor.executiveId, advisor.id);
}

function assertOwnedQuotation(record, actor) {
  const seller = sellerIdentity(actor);
  if (sellerIdFromQuotation(record) !== seller.sellerId) {
    throw new SellerBusinessConnectError('QUOTATION_NOT_OWNED_BY_SELLER', 'Solo podés consultar o editar cotizaciones creadas por tu usuario vendedor.', 403);
  }
  return record;
}

async function listQuotations(actor, env) {
  const payload = await requestConnect('/api/v1/business/vqs/quotations?limit=200', actor, {}, env);
  const records = resultsOf(payload).filter((record) => sellerIdFromQuotation(record) === sellerIdentity(actor).sellerId);
  return { data: records, count: records.length };
}

async function getQuotation(projectId, actor, env) {
  const payload = await requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}`, actor, {}, env);
  assertOwnedQuotation(dataOf(payload), actor);
  return payload;
}

async function updateQuotation(projectId, document, actor, env) {
  await getQuotation(projectId, actor, env);
  const normalized = await normalizeSellerQuotation(document, actor, env);
  return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}`, actor, { method: 'PATCH', body: normalized }, env);
}

async function sendQuotationWhatsApp(projectId, actor, body = {}, env) {
  await getQuotation(projectId, actor, env);
  return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/send-whatsapp`, actor, {
    method: 'POST',
    body
  }, env);
}

module.exports = {
  SellerBusinessConnectError,
  createQuotation,
  createSellerCustomer,
  getQuotation,
  listLogisticsRules,
  listQuotations,
  listSellerCustomers,
  normalizeSellerQuotation,
  prepareBudget,
  requestConnect,
  resolveAuthorizedItems,
  resolveCatalogPricing,
  sellerIdentity,
  sendQuotationWhatsApp,
  updateQuotation,
  updateSellerCustomer
};
