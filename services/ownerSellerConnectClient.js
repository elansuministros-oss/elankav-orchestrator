'use strict';

class OwnerSellerConnectError extends Error {
  constructor(code, message, statusCode, details = null) {
    super(message || code || 'OWNER_SELLER_CONNECT_ERROR');
    this.name = 'OwnerSellerConnectError';
    this.code = code || 'OWNER_SELLER_CONNECT_ERROR';
    this.statusCode = statusCode || 500;
    this.details = details;
  }
}

function config(env = process.env) {
  const baseUrl = String(env.CONNECT_BASE_URL || 'https://connect.elankav.com').trim().replace(/\/+$/, '');
  const token = String(env.VQS_API_TOKEN || '').trim();
  if (!token) {
    throw new OwnerSellerConnectError(
      'VQS_API_TOKEN_REQUIRED',
      'No está configurada la credencial interna de CONNECT.',
      503
    );
  }
  return { baseUrl, token };
}

function headers(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Elankav-Platform': 'ELAN_IA',
    'X-Elankav-Actor-Type': 'owner',
    'X-Elankav-Role': 'owner',
    'X-Elankav-User-Id': 'owner-whatsapp',
    'X-Elankav-Source': 'OWNER_WHATSAPP'
  };
}

async function requestSeller(path, options = {}, env = process.env) {
  const normalizedPath = String(path || '');
  if (!normalizedPath.startsWith('/api/v1/sellers')) {
    throw new OwnerSellerConnectError('SELLER_PATH_NOT_ALLOWED', 'Ruta de vendedores no autorizada.', 403);
  }

  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) {
    throw new OwnerSellerConnectError('SELLER_METHOD_NOT_ALLOWED', 'Método no autorizado para vendedores.', 405);
  }

  const { baseUrl, token } = config(env);
  const response = await fetch(`${baseUrl}${normalizedPath}`, {
    method,
    headers: headers(token),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(30_000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const nested = payload && typeof payload.error === 'object' ? payload.error : {};
    throw new OwnerSellerConnectError(
      String(payload.code || nested.code || 'CONNECT_SELLER_REQUEST_FAILED'),
      String((typeof payload.error === 'string' ? payload.error : nested.message) || payload.message || 'CONNECT rechazó la operación de vendedor.'),
      response.status,
      nested.details || payload.details || null
    );
  }
  return payload;
}

async function listSellers(env) {
  return requestSeller('/api/v1/sellers', {}, env);
}

async function createSeller(input, env) {
  return requestSeller('/api/v1/sellers', { method: 'POST', body: input }, env);
}

async function setSellerPlatforms(sellerId, platforms, env) {
  const id = encodeURIComponent(String(sellerId || '').trim());
  if (!id) throw new OwnerSellerConnectError('SELLER_ID_REQUIRED', 'Falta el ID oficial del vendedor.', 400);
  return requestSeller(`/api/v1/sellers/${id}/platforms`, {
    method: 'PUT',
    body: { platforms: Array.isArray(platforms) ? platforms : [] }
  }, env);
}

module.exports = {
  OwnerSellerConnectError,
  createSeller,
  listSellers,
  requestSeller,
  setSellerPlatforms
};
