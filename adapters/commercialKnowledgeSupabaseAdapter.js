'use strict';

const TABLE = 'commercial_products';

function normalize(value) {
  return String(value || '').trim();
}

function getConfig() {
  const url = normalize(process.env.SUPABASE_URL);
  const key = normalize(
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!url || !key) {
    const error = new Error('COMMERCIAL_KNOWLEDGE_NOT_CONFIGURED');
    error.code = 'COMMERCIAL_KNOWLEDGE_NOT_CONFIGURED';
    throw error;
  }

  return { url: url.replace(/\/+$/, ''), key };
}

function authHeaders(key) {
  return {
    apikey: key,
    Authorization: key.split('.').length === 3 ? `Bearer ${key}` : key,
    Accept: 'application/json'
  };
}

async function listActiveProducts({ platformId } = {}) {
  const { url, key } = getConfig();
  const query = new URLSearchParams({
    select: '*',
    active: 'eq.true',
    order: 'product_name.asc'
  });

  if (normalize(platformId)) {
    query.set('platform_id', `eq.${normalize(platformId).toUpperCase()}`);
  }

  const response = await fetch(`${url}/rest/v1/${TABLE}?${query}`, {
    headers: authHeaders(key),
    signal: AbortSignal.timeout(10000)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !Array.isArray(data)) {
    const error = new Error(`COMMERCIAL_KNOWLEDGE_HTTP_${response.status}`);
    error.code = 'COMMERCIAL_KNOWLEDGE_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }

  return data;
}

module.exports = {
  TABLE,
  authHeaders,
  getConfig,
  listActiveProducts
};
