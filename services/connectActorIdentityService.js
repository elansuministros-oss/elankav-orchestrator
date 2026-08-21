'use strict';

const {
  resolveConnectToken,
  resolveConnectUrl
} = require('./connectConversationClient');

function clean(value) {
  return String(value || '').trim();
}

function isLid(value) {
  return clean(value).toLowerCase().endsWith('@lid');
}

function normalizePhone(value) {
  const raw = clean(value);
  if (!raw || isLid(raw)) return '';
  const lower = raw.toLowerCase();
  if (raw.includes('@') && !lower.endsWith('@c.us') && !lower.endsWith('@s.whatsapp.net')) return '';
  const digits = raw.split('@')[0].replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 8 ? `505${digits}` : digits;
}

function collectIdentityCandidates(input = {}) {
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const supplied = Array.isArray(input.identities) ? input.identities : [];
  const metadataCandidates = Array.isArray(metadata.identityCandidates) ? metadata.identityCandidates : [];
  return [...new Set([
    input.identity,
    input.externalUserId,
    input.chatId,
    input.phone,
    metadata.senderRaw,
    metadata.chatId,
    ...supplied,
    ...metadataCandidates
  ].map(clean).filter(Boolean))];
}

function scalarPhone(value, allowPlainDigits = false) {
  const raw = clean(value);
  if (!raw || isLid(raw)) return '';
  if (!allowPlainDigits && !raw.includes('@') && !raw.startsWith('+')) return '';
  const candidate = normalizePhone(raw);
  return candidate && candidate.length >= 8 && candidate.length <= 15 ? candidate : '';
}

function findPhoneInContactPayload(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const phone = findPhoneInContactPayload(item, depth + 1);
      if (phone) return phone;
    }
    return '';
  }
  if (typeof value !== 'object') return scalarPhone(value, false);

  for (const key of ['phone', 'number', 'phoneNumber', 'mobile']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const phone = scalarPhone(value[key], true);
    if (phone) return phone;
  }

  for (const key of ['serialized', '_serialized', 'jid', 'contactId', 'id', 'wid']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const nested = value[key];
    const phone = typeof nested === 'object'
      ? findPhoneInContactPayload(nested, depth + 1)
      : scalarPhone(nested, false);
    if (phone) return phone;
  }

  for (const nested of Object.values(value)) {
    if (!nested || typeof nested !== 'object') continue;
    const phone = findPhoneInContactPayload(nested, depth + 1);
    if (phone) return phone;
  }
  return '';
}

function unavailableActor(authority, error = null) {
  return {
    resolutionStatus: 'unavailable',
    role: 'unavailable',
    registered: false,
    actorId: null,
    sellerId: null,
    customerId: null,
    providerId: null,
    familyId: null,
    prospectId: null,
    scopes: [],
    platformAllowed: false,
    authority,
    errorCode: error?.code || null
  };
}

async function resolvePhoneFromWahaIdentity(identity, {
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  const contactId = clean(identity);
  if (!isLid(contactId) || typeof fetchImpl !== 'function') return '';

  const baseUrl = clean(env.WAHA_BASE_URL || 'https://waha.elankav.com').replace(/\/+$/, '');
  const session = clean(env.WAHA_SESSION || 'ELANKAV');
  const apiKey = clean(env.WAHA_API_KEY || env.WAHA_API_TOKEN);
  const params = new URLSearchParams({ session, contactId });
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  try {
    const response = await fetchImpl(`${baseUrl}/api/contacts?${params.toString()}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return '';
    const payload = await response.json().catch(() => ({}));
    return findPhoneInContactPayload(payload);
  } catch {
    return '';
  }
}

async function resolveCommercialActor(input = {}, {
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('FETCH_NOT_AVAILABLE'), { code: 'FETCH_NOT_AVAILABLE' });
  }

  const identities = collectIdentityCandidates(input);
  let normalizedPhone = identities.map(normalizePhone).find(Boolean) || '';

  if (!normalizedPhone) {
    for (const identity of identities) {
      normalizedPhone = await resolvePhoneFromWahaIdentity(identity, { fetchImpl, env });
      if (normalizedPhone) break;
    }
  }

  // Missing technical identity is not equivalent to a confirmed new Prospect.
  if (!normalizedPhone && !identities.length) {
    return unavailableActor('identity_missing');
  }

  const token = resolveConnectToken(env);
  if (!token) {
    throw Object.assign(new Error('CONNECT_INTERNAL_TOKEN_REQUIRED'), {
      code: 'CONNECT_INTERNAL_TOKEN_REQUIRED'
    });
  }

  const baseUrl = resolveConnectUrl(env).replace(/\/+$/, '');
  const url = new URL(`${baseUrl}/api/v1/actor-identity/resolve`);
  if (normalizedPhone) url.searchParams.set('phone', normalizedPhone);
  identities.forEach((identity) => url.searchParams.append('identities', identity));
  if (identities[0]) url.searchParams.set('identity', identities[0]);
  url.searchParams.set('platform', clean(input.platform || 'ELANVISUAL').toUpperCase() || 'ELANVISUAL');

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

  const actor = payload.data;
  const inferredStatus = actor.resolutionStatus ||
    (actor.role === 'prospect' && actor.registered !== true ? 'not_found' : 'resolved');

  return {
    ...actor,
    resolutionStatus: inferredStatus
  };
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

    // Fail closed. A database, schema, timeout or CONNECT error is never evidence
    // that the person is a Prospect.
    return unavailableActor('identity_unavailable', error);
  }
}

module.exports = {
  collectIdentityCandidates,
  findPhoneInContactPayload,
  isLid,
  normalizePhone,
  resolveCommercialActor,
  resolveCommercialActorSafely,
  resolvePhoneFromWahaIdentity,
  scalarPhone,
  unavailableActor
};
