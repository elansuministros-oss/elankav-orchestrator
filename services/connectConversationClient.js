'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';

function clean(value) {
  return String(value || '').trim();
}

function resolveConnectUrl(env = process.env) {
  return clean(env.ELANKAV_CONNECT_URL || env.CONNECT_URL || env.CONNECT_API_URL) || DEFAULT_CONNECT_URL;
}

function resolveConnectToken(env = process.env) {
  return clean(
    env.CONNECT_INTERNAL_API_TOKEN ||
    env.CONNECT_INTERNAL_TOKEN ||
    env.ELANKAV_CONNECT_INTERNAL_TOKEN ||
    env.ORCHESTRATOR_INTERNAL_TOKEN
  );
}

function buildHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Elankav-Internal-Token': token,
    'X-Elankav-Platform': 'ORCHESTRATOR'
  };
}

async function publishConversationEvent(event, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (typeof fetchImpl !== 'function') {
    const error = new Error('FETCH_NOT_AVAILABLE');
    error.code = 'FETCH_NOT_AVAILABLE';
    throw error;
  }
  const token = resolveConnectToken(env);
  if (!token) {
    const error = new Error('CONNECT_INTERNAL_TOKEN_REQUIRED');
    error.code = 'CONNECT_INTERNAL_TOKEN_REQUIRED';
    throw error;
  }
  const baseUrl = resolveConnectUrl(env).replace(/\/+$/, '');
  const response = await fetchImpl(`${baseUrl}/api/v1/conversations/events`, {
    method: 'POST',
    headers: {
      ...buildHeaders(token),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || payload?.error || `CONNECT_HTTP_${response.status}`);
    error.code = payload?.error?.code || payload?.code || 'CONNECT_CONVERSATION_EVENT_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function requestConversationDecision({ identity, platform = 'ELANVISUAL', message = '', ownerMode = false } = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const token = resolveConnectToken(env);
  if (!token) throw Object.assign(new Error('CONNECT_INTERNAL_TOKEN_REQUIRED'), { code: 'CONNECT_INTERNAL_TOKEN_REQUIRED' });
  const response = await fetchImpl(`${resolveConnectUrl(env).replace(/\/+$/, '')}/api/v1/conversations/decision`, {
    method: 'POST', headers: { ...buildHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, platform, message, ownerMode }), signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw Object.assign(new Error(payload?.error?.message || `CONNECT_DECISION_HTTP_${response.status}`), { code: payload?.error?.code || 'CONNECT_CONVERSATION_DECISION_FAILED', status: response.status });
  return payload;
}

async function publishConversationEventSafely(event, options) {
  try {
    return await publishConversationEvent(event, options);
  } catch (error) {
    console.error('[CONNECT_CONVERSATION_EVENT_FAILED]', {
      code: error.code || null,
      status: error.status || null,
      message: error.message
    });
    return { ok: false, error: error.code || error.message };
  }
}

module.exports = {
  DEFAULT_CONNECT_URL,
  publishConversationEvent,
  publishConversationEventSafely,
  requestConversationDecision,
  resolveConnectToken,
  resolveConnectUrl
};
