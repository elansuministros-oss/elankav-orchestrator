'use strict';

const {
  resolveConnectToken,
  resolveConnectUrl
} = require('./connectConversationClient');

function clean(value) {
  return String(value || '').trim();
}

function normalizePhone(value) {
  return clean(value).replace(/\D/g, '');
}

async function resolveCommercialActor({ phone, platform = 'ELANVISUAL' } = {}, {
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('FETCH_NOT_AVAILABLE'), { code: 'FETCH_NOT_AVAILABLE' });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return {
      role: 'prospect',
      registered: false,
      actorId: null,
      sellerId: null,
      customerId: null,
      prospectId: null,
      scopes: ['price.read', 'quotation.formal.request_owner'],
      authority: 'phone_missing'
    };
  }

  const token = resolveConnectToken(env);
  if (!token) {
    throw Object.assign(new Error('CONNECT_INTERNAL_TOKEN_REQUIRED'), {
      code: 'CONNECT_INTERNAL_TOKEN_REQUIRED'
    });
  }

  const baseUrl = resolveConnectUrl(env).replace(/\/+$/, '');
  const url = new URL(`${baseUrl}/api/v1/actor-identity/resolve`);
  url.searchParams.set('phone', normalizedPhone);
  url.searchParams.set('platform', clean(platform).toUpperCase() || 'ELANVISUAL');

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Elankav-Internal-Token': token,
      'X-Elankav-Source': 'ORCHESTRATOR_WHATSAPP'
    },
    signal: AbortSignal.timeout(10000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data) {
    const error = new Error(
      payload?.error?.message || `CONNECT_ACTOR_IDENTITY_HTTP_${response.status}`
    );
    error.code = payload?.error?.code || 'CONNECT_ACTOR_IDENTITY_FAILED';
    error.status = response.status;
    throw error;
  }

  return payload.data;
}

async function resolveCommercialActorSafely(input, options) {
  try {
    return await resolveCommercialActor(input, options);
  } catch (error) {
    console.error('[CONNECT_ACTOR_IDENTITY_FAILED]', {
      code: error.code || null,
      status: error.status || null,
      message: error.message
    });

    return {
      role: 'prospect',
      registered: false,
      actorId: null,
      sellerId: null,
      customerId: null,
      prospectId: null,
      scopes: ['price.read', 'quotation.formal.request_owner'],
      authority: 'safe_fallback'
    };
  }
}

module.exports = {
  normalizePhone,
  resolveCommercialActor,
  resolveCommercialActorSafely
};
