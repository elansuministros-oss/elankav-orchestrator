'use strict';

function clean(value) {
  return String(value || '').trim();
}

function getConfig() {
  const writeUrl = clean(process.env.CRM_API_URL);
  const token = clean(process.env.CRM_INTERNAL_TOKEN);
  if (!writeUrl || !token) {
    const error = new Error('CRM_READ_NOT_CONFIGURED');
    error.code = 'CRM_READ_NOT_CONFIGURED';
    throw error;
  }
  return {
    url: writeUrl.replace(/\/api\/crm\/?$/, '/api/crm-clients'),
    token
  };
}

async function searchClients({ query, platform = '', limit = 12 } = {}) {
  const { url, token } = getConfig();
  const params = new URLSearchParams({ q: clean(query), limit: String(limit) });
  if (clean(platform)) params.set('platform', clean(platform).toLowerCase());

  const response = await fetch(`${url}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error || `CRM_READ_HTTP_${response.status}`);
    error.code = payload?.error || 'CRM_READ_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return Array.isArray(payload.clients) ? payload.clients : [];
}

module.exports = { getConfig, searchClients };
