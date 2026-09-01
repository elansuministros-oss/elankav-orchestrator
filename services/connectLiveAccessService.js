'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';

function clean(value) { return String(value || '').trim(); }
function connectBaseUrl() { return clean(process.env.ELANKAV_CONNECT_URL || process.env.CONNECT_API_URL || DEFAULT_CONNECT_URL).replace(/\/+$/, ''); }
function connectToken() { return clean(process.env.CONNECT_INTERNAL_TOKEN || process.env.CRM_INTERNAL_TOKEN || process.env.VQS_API_TOKEN); }

async function createConnectLiveSession({ phone, identity, platform = 'ELANVISUAL', fetchImpl = fetch } = {}) {
  const token = connectToken();
  if (!token) {
    const error = new Error('CONNECT_INTERNAL_TOKEN_NOT_CONFIGURED');
    error.code = 'CONNECT_INTERNAL_TOKEN_NOT_CONFIGURED';
    throw error;
  }
  const response = await fetchImpl(`${connectBaseUrl()}/api/v1/live-access/session`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Elankav-Platform': 'ORCHESTRATOR',
      'X-Elankav-Actor-Type': 'system'
    },
    body: JSON.stringify({ phone, identity, platform }),
    signal: AbortSignal.timeout(12_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `CONNECT_LIVE_HTTP_${response.status}`);
    error.code = payload?.error?.code || 'CONNECT_LIVE_SESSION_FAILED';
    error.status = response.status;
    throw error;
  }
  if (!payload?.data?.url || !payload?.data?.token) {
    const error = new Error('CONNECT_LIVE_SESSION_INVALID_RESPONSE');
    error.code = 'CONNECT_LIVE_SESSION_INVALID_RESPONSE';
    throw error;
  }
  return payload.data;
}

module.exports = { createConnectLiveSession };
