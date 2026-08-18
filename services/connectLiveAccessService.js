'use strict';

const { resolveConnectToken, resolveConnectUrl } = require('./connectConversationClient');

function clean(value) { return String(value || '').trim(); }

function isLiveModeRequest(text) {
  const normalized = clean(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /(?:elan\s*)?(?:activa(?:te)?|abre|abrime|inicia|entrar|dame acceso).*(?:modo\s*)?(?:copiloto|piloto|live)/.test(normalized) ||
    /^(?:elan\s*)?(?:modo\s*)?(?:copiloto|piloto|elan live|live)$/.test(normalized);
}

async function requestLiveSession({ phone, externalUserId, platform = 'ELANVISUAL', fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const token = resolveConnectToken(env);
  if (!token) throw Object.assign(new Error('CONNECT_INTERNAL_TOKEN_REQUIRED'), { code: 'CONNECT_INTERNAL_TOKEN_REQUIRED' });
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('FETCH_NOT_AVAILABLE'), { code: 'FETCH_NOT_AVAILABLE' });

  const baseUrl = resolveConnectUrl(env).replace(/\/+$/, '');
  const response = await fetchImpl(`${baseUrl}/api/v1/live-access/session`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Elankav-Internal-Token': token,
      'X-Elankav-Source': 'ORCHESTRATOR_WHATSAPP'
    },
    body: JSON.stringify({
      phone: clean(phone) || null,
      identity: clean(externalUserId) || null,
      externalUserId: clean(externalUserId) || null,
      platform: clean(platform).toUpperCase() || 'ELANVISUAL'
    }),
    signal: AbortSignal.timeout(10000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data?.url) {
    const error = new Error(payload?.error?.message || `CONNECT_LIVE_ACCESS_HTTP_${response.status}`);
    error.code = payload?.error?.code || 'CONNECT_LIVE_ACCESS_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

module.exports = { isLiveModeRequest, requestLiveSession };
