'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';

function clean(value) {
  return String(value || '').trim();
}

function isPriorityLiveCommand(value) {
  const normalized = clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /(?:elan\s*)?(?:activa(?:te)?|abre|abrime|inicia|entrar|dame acceso).*(?:modo\s*)?(?:copiloto|live)/.test(normalized) ||
    /^(?:modo\s*)?(?:copiloto|elan live)$/.test(normalized);
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

function requireTransport(fetchImpl, env) {
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
  return { token, baseUrl: resolveConnectUrl(env).replace(/\/+$/, '') };
}

async function publishConversationEvent(event, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const { token, baseUrl } = requireTransport(fetchImpl, env);
  const response = await fetchImpl(`${baseUrl}/api/v1/conversations/events`, {
    method: 'POST',
    headers: { ...buildHeaders(token), 'Content-Type': 'application/json' },
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
  if (isPriorityLiveCommand(message)) {
    return {
      ok: true,
      action: 'RESPOND',
      reason: 'priority_live_command',
      platform: { platformId: String(platform || 'ELANVISUAL').toUpperCase() },
      welcome: { send: false, text: '' },
      history: []
    };
  }
  const { token, baseUrl } = requireTransport(fetchImpl, env);
  const response = await fetchImpl(`${baseUrl}/api/v1/conversations/decision`, {
    method: 'POST', headers: { ...buildHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, platform, message, ownerMode }), signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw Object.assign(new Error(payload?.error?.message || `CONNECT_DECISION_HTTP_${response.status}`), { code: payload?.error?.code || 'CONNECT_CONVERSATION_DECISION_FAILED', status: response.status });
  return payload;
}

async function readUnifiedMemory({ actorKey, actorRole, platform = 'ELANVISUAL', limit = 20 } = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const key = clean(actorKey);
  if (!key) throw Object.assign(new Error('ACTOR_KEY_REQUIRED'), { code: 'ACTOR_KEY_REQUIRED' });
  const { token, baseUrl } = requireTransport(fetchImpl, env);
  const query = new URLSearchParams({
    actorKey: key,
    actorRole: clean(actorRole),
    platform: clean(platform) || 'ELANVISUAL',
    limit: String(Math.max(1, Math.min(Number(limit) || 20, 50)))
  });
  const response = await fetchImpl(`${baseUrl}/api/v1/unified-memory?${query.toString()}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw Object.assign(new Error(payload?.error?.message || `CONNECT_MEMORY_HTTP_${response.status}`), {
      code: payload?.error?.code || 'CONNECT_UNIFIED_MEMORY_FAILED',
      status: response.status
    });
  }
  return payload;
}

async function publishUnifiedMemoryEvent(event, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const { token, baseUrl } = requireTransport(fetchImpl, env);
  const response = await fetchImpl(`${baseUrl}/api/v1/unified-memory/events`, {
    method: 'POST',
    headers: { ...buildHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw Object.assign(new Error(payload?.error?.message || `CONNECT_MEMORY_HTTP_${response.status}`), {
      code: payload?.error?.code || 'CONNECT_UNIFIED_MEMORY_EVENT_FAILED',
      status: response.status
    });
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

async function publishUnifiedMemoryEventSafely(event, options) {
  try {
    return await publishUnifiedMemoryEvent(event, options);
  } catch (error) {
    console.error('[CONNECT_UNIFIED_MEMORY_EVENT_FAILED]', {
      code: error.code || null,
      status: error.status || null,
      message: error.message
    });
    return { ok: false, error: error.code || error.message };
  }
}

module.exports = {
  DEFAULT_CONNECT_URL,
  isPriorityLiveCommand,
  publishConversationEvent,
  publishConversationEventSafely,
  publishUnifiedMemoryEvent,
  publishUnifiedMemoryEventSafely,
  readUnifiedMemory,
  requestConversationDecision,
  resolveConnectToken,
  resolveConnectUrl
};