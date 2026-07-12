'use strict';

function normalize(value) { return String(value || '').trim(); }

function getConfig() {
  const url = normalize(process.env.CRM_API_URL);
  const token = normalize(process.env.CRM_INTERNAL_TOKEN);
  if (!url || !token) {
    const error = new Error('CRM_WRITE_NOT_CONFIGURED');
    error.code = 'CRM_WRITE_NOT_CONFIGURED';
    throw error;
  }
  return { url, token };
}

async function requestCrmWrite(payload) {
  const { url, token } = getConfig();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || `CRM_WRITE_HTTP_${response.status}`);
    error.code = data?.error || 'CRM_WRITE_REQUEST_FAILED';
    error.status = response.status;
    error.crmStatus = data?.status || null;
    error.details = data;
    throw error;
  }
  return data;
}

const createSupplier = payload => requestCrmWrite({ action: 'create_supplier', ...payload });
const createClient = payload => requestCrmWrite({ action: 'create_client', ...payload });

module.exports = { getConfig, requestCrmWrite, createSupplier, createClient };
