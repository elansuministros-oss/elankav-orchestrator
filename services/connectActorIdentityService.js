'use strict';

const { resolveConnectUrl } = require('./connectPlatformKnowledgeService');
const { buildHeaders, resolveInternalToken } = require('./connectAiRuntimeService');

const DEFAULT_TIMEOUT_MS = 5000;

function clean(value) {
  return String(value || '').trim();
}

function buildIdentityParams({ identity, externalUserId, phone, chatId, platform } = {}) {
  const params = new URLSearchParams();
  const values = [
    ['identity', identity],
    ['externalUserId', externalUserId],
    ['phone', phone],
    ['chatId', chatId],
    ['platform', platform || 'ELANVISUAL']
  ];
  for (const [key, value] of values) {
    const normalized = clean(value);
    if (normalized) params.set(key, normalized);
  }
  return params;
}

function validateActorIdentityPayload(payload) {
  const data = payload?.data;
  if (!data || typeof data !== 'object') {
    const error = new Error('CONNECT_ACTOR_IDENTITY_INVALID');
    error.code = 'CONNECT_ACTOR_IDENTITY_INVALID';
    throw error;
  }

  const role = clean(data.role).toLowerCase();
  const validRoles = new Set(['owner', 'seller', 'family', 'customer', 'provider', 'prospect']);
  if (!validRoles.has(role)) {
    const error = new Error('CONNECT_ACTOR_IDENTITY_ROLE_INVALID');
    error.code = 'CONNECT_ACTOR_IDENTITY_ROLE_INVALID';
    throw error;
  }

  const commercialRole = clean(data.commercialRole).toLowerCase();
  if (role === 'prospect' && commercialRole &&
      !['client_prospect', 'supplier_prospect', 'unknown_prospect'].includes(commercialRole)) {
    const error = new Error('CONNECT_ACTOR_IDENTITY_COMMERCIAL_ROLE_INVALID');
    error.code = 'CONNECT_ACTOR_IDENTITY_COMMERCIAL_ROLE_INVALID';
    throw error;
  }

  return {
    ...data,
    role,
    commercialRole: role === 'prospect'
      ? (commercialRole || 'unknown_prospect')
      : null
  };
}

async function fetchConnectActorIdentity({
  identity,
  externalUserId,
  phone,
  chatId,
  platform,
  fetchFn = globalThis.fetch
} = {}) {
  if (typeof fetchFn !== 'function') {
    const error = new Error('FETCH_NOT_AVAILABLE');
    error.code = 'FETCH_NOT_AVAILABLE';
    throw error;
  }

  if (!resolveInternalToken()) {
    const error = new Error('CONNECT_ACTOR_IDENTITY_TOKEN_REQUIRED');
    error.code = 'CONNECT_ACTOR_IDENTITY_TOKEN_REQUIRED';
    throw error;
  }

  const params = buildIdentityParams({ identity, externalUserId, phone, chatId, platform });
  if (![...params.keys()].some(key => key !== 'platform')) {
    const error = new Error('CONNECT_ACTOR_IDENTITY_INPUT_REQUIRED');
    error.code = 'CONNECT_ACTOR_IDENTITY_INPUT_REQUIRED';
    throw error;
  }

  const response = await fetchFn(
    `${resolveConnectUrl()}/api/v1/actor-identity/resolve?${params.toString()}`,
    {
      method: 'GET',
      headers: buildHeaders(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message ||
      payload?.error ||
      `CONNECT_ACTOR_IDENTITY_HTTP_${response.status}`
    );
    error.code = payload?.error?.code || 'CONNECT_ACTOR_IDENTITY_REQUEST_FAILED';
    error.status = response.status;
    error.details = payload;
    throw error;
  }

  return validateActorIdentityPayload(payload);
}

async function loadConnectActorIdentitySafely(input = {}) {
  try {
    const identity = await fetchConnectActorIdentity(input);
    return {
      available: true,
      authority: 'CONNECT_ACTOR_IDENTITY',
      identity
    };
  } catch (error) {
    console.error('[CONNECT_ACTOR_IDENTITY_UNAVAILABLE]', {
      code: error?.code || null,
      status: error?.status || null,
      message: error?.message || String(error)
    });

    return {
      available: false,
      authority: 'CONNECT_ACTOR_IDENTITY',
      identity: null,
      error: error?.code || error?.message || 'CONNECT_ACTOR_IDENTITY_UNAVAILABLE'
    };
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  buildIdentityParams,
  fetchConnectActorIdentity,
  loadConnectActorIdentitySafely,
  validateActorIdentityPayload
};
