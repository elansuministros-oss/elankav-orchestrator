'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';

function clean(value) {
  return String(value || '').trim();
}

function resolveConnectUrl(env = process.env) {
  return clean(env.ELANKAV_CONNECT_URL || env.CONNECT_URL) || DEFAULT_CONNECT_URL;
}

function resolveConnectToken(env = process.env) {
  return clean(env.CONNECT_INTERNAL_TOKEN || env.ELANKAV_CONNECT_INTERNAL_TOKEN);
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
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Elankav-Platform': 'ORCHESTRATOR'
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
  resolveConnectToken,
  resolveConnectUrl
};

