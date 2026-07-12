'use strict';

function normalize(value) {
  return String(value || '').trim();
}

function getConfig() {
  const url = normalize(process.env.CRM_API_URL);
  const token = normalize(process.env.CRM_INTERNAL_TOKEN);

  if (!url || !token) {
    const error = new Error('CRM_CONTEXT_NOT_CONFIGURED');
    error.code = 'CRM_CONTEXT_NOT_CONFIGURED';
    throw error;
  }

  return { url, token };
}

async function fetchCrmDashboard() {
  const { url, token } = getConfig();

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(8000)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    const error = new Error(
      data?.error ||
      `CRM_CONTEXT_HTTP_${response.status}`
    );

    error.code = 'CRM_CONTEXT_REQUEST_FAILED';
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

module.exports = {
  getConfig,
  fetchCrmDashboard
};
