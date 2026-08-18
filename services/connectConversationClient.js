'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const { loadProviderContinuityHistory } = require('./providerConversationContinuityService');

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

function isRegisteredProviderMessage(value) {
  return /^\s*\[PROVEEDOR REGISTRADO:/i.test(clean(value));
}

function isProviderConversationEvent(event = {}) {
  const actorType = clean(event?.actorType).toLowerCase();
  const metadata = event?.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  return actorType === 'provider' || metadata.providerRecognized === true || metadata.providerMode === true;
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

async function requestConversationDecision(
  { identity, platform = 'ELANVISUAL', message = '', ownerMode = false, phone = '' } = {},
  { fetchImpl = globalThis.fetch, env = process.env, providerContinuityLoader = loadProviderContinuityHistory } = {}
) {
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

  // A registered provider must never enter CONNECT's prospect decision path.
  // The webhook resolves provider identity first, and this branch restores the
  // latest pending Owner request from durable audit history.
  if (isRegisteredProviderMessage(message)) {
    let history = [];
    try {
      history = await providerContinuityLoader({ message, phone: phone || identity });
    } catch (error) {
      console.error('[PROVIDER_CONTINUITY_LOAD_FAILED]', {
        code: error?.code || null,
        message: error?.message || String(error)
      });
    }
    return {
      ok: true,
      action: 'RESPOND',
      reason: 'registered_provider_continuity',
      platform: { platformId: String(platform || 'ELANVISUAL').toUpperCase() },
      instructions: 'El remitente es un proveedor registrado. Continuá exclusivamente la relación comercial pendiente. No lo trates como cliente, lead o prospecto y no envíes bienvenida de ventas.',
      prospect: null,
      history,
      platformHistory: history,
      conversationId: null,
      welcome: { send: false, text: '' }
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
    limit: String(Math.max(1, Math.min(Number(limit) || 20, 50))
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
  // crm_conversations currently has prospect-centric persistence. Until that
  // schema is generalized, provider events are intentionally kept out of it;
  // provider commercial intelligence and Owner audit remain the durable sources.
  if (isProviderConversationEvent(event)) {
    return { ok: true, skipped: true, reason: 'REGISTERED_PROVIDER_NOT_PROSPECT' };
  }
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
  isProviderConversationEvent,
  isRegisteredProviderMessage,
  publishConversationEvent,
  publishConversationEventSafely,
  publishUnifiedMemoryEvent,
  publishUnifiedMemoryEventSafely,
  readUnifiedMemory,
  requestConversationDecision,
  resolveConnectToken,
  resolveConnectUrl
};