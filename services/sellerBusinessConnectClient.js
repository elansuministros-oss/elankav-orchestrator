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

function actorHeaders(token, actor = {}, extra = {}) {
  const sellerId = String(actor?.sellerId || actor?.actorId || '').trim();
  if (!sellerId) throw new SellerBusinessConnectError('SELLER_ID_REQUIRED', 'No se pudo resolver el vendedor.', 403);
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Elankav-Platform': 'ELANVISUAL',
    'X-Elankav-Actor-Type': 'seller',
    'X-Elankav-Role': 'seller',
    'X-Elankav-Seller-Id': sellerId,
    'X-Elankav-Seller-Name': String(actor?.displayName || '').trim(),
    'X-Elankav-Source': 'SELLER_WHATSAPP',
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

async function createSellerCustomer(input, actor, env) {
  return requestConnect('/api/v1/business/vqs/seller/customers', actor, { method: 'POST', body: input }, env);
}

async function listSellerCustomers(actor, search = '', env) {
  const suffix = search ? `?q=${query(search)}` : '';
  return requestConnect(`/api/v1/business/vqs/seller/customers${suffix}`, actor, {}, env);
}

async function resolveCatalogPricing(input, actor, env) {
  return requestConnect('/api/v1/business/vqs/pricing/resolve', actor, { method: 'POST', body: input }, env);
}

async function listLogisticsRules(actor, env) {
  return requestConnect('/api/v1/business/vqs/logistics-rules', actor, {}, env);
}

async function createQuotation(document, idempotencyKey, actor, env) {
  const key = String(idempotencyKey || '').trim();
  return requestConnect('/api/v1/business/vqs/quotations', actor, {
    method: 'POST',
    body: document,
    headers: key ? { 'Idempotency-Key': key } : {}
  }, env);
}

async function sendQuotationWhatsApp(projectId, actor, body = {}, env) {
  return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/send-whatsapp`, actor, {
    method: 'POST',
    body
  }, env);
}

module.exports = {
  SellerBusinessConnectError,
  createQuotation,
  createSellerCustomer,
  listLogisticsRules,
  listSellerCustomers,
  requestConnect,
  resolveCatalogPricing,
  sendQuotationWhatsApp
};
