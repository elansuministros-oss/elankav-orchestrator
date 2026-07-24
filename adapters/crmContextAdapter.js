'use strict';

function normalize(value) {
  return String(value || '').trim();
}

function trimTrailingSlashes(value) {
  return normalize(value).replace(/\/+$/, '');
}

function getConfig() {
  const baseUrl = trimTrailingSlashes(
    process.env.CONNECT_API_URL ||
    process.env.CRM_API_URL ||
    'https://elankav-connect.vercel.app'
  );
  const token = normalize(
    process.env.CONNECT_INTERNAL_TOKEN ||
    process.env.CRM_INTERNAL_TOKEN
  );

  if (!baseUrl) {
    const error = new Error('CONNECT_CONTEXT_NOT_CONFIGURED');
    error.code = 'CONNECT_CONTEXT_NOT_CONFIGURED';
    throw error;
  }

  return { baseUrl, token };
}

function buildHeaders(token) {
  const headers = {
    Accept: 'application/json',
    'X-Elankav-Platform': 'orchestrator',
    'X-Elankav-Actor-Type': 'system'
  };

  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function requestJson(pathname, { baseUrl, token }) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'GET',
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(8000)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      data?.error?.message ||
      data?.error ||
      `CONNECT_HTTP_${response.status}`
    );
    error.code = 'CONNECT_CONTEXT_REQUEST_FAILED';
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

async function fetchCrmDashboard() {
  const config = getConfig();

  const [health, business, leads, opportunities, quotes, orders] =
    await Promise.all([
      requestJson('/health', config),
      requestJson('/api/v1/business', config),
      requestJson('/api/v1/leads', config),
      requestJson('/api/v1/opportunities', config),
      requestJson('/api/v1/quotes', config),
      requestJson('/api/v1/orders', config)
    ]);

  const businesses = toArray(business);
  const leadItems = toArray(leads);
  const opportunityItems = toArray(opportunities);
  const quoteItems = toArray(quotes);
  const orderItems = toArray(orders);

  return {
    ok: true,
    status: health?.status || 'READY',
    version: health?.version || null,
    source: 'ELANKAV_CONNECT',
    counts: {
      identities: businesses.length,
      conversations: 0,
      messages: 0,
      businesses: businesses.length,
      leads: leadItems.length,
      opportunities: opportunityItems.length,
      quotes: quoteItems.length,
      orders: orderItems.length
    },
    identities: businesses.map(item => ({
      canonical_id: item.id || item.businessId || null,
      display_name: item.name || item.legalName || item.tradeName || null,
      entity_type: item.type || item.businessType || 'business'
    })),
    commercial: {
      leads: leadItems,
      opportunities: opportunityItems,
      quotes: quoteItems,
      orders: orderItems
    }
  };
}

module.exports = {
  getConfig,
  fetchCrmDashboard
};
