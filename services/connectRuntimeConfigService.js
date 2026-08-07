'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const DEFAULT_TIMEOUT_MS = 8000;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePlatform(value) {
  const normalized = normalizeText(value).toLowerCase();
  const aliases = {
    visual: 'elanvisual',
    elanvisual: 'elanvisual',
    home: 'elanhome',
    elanhome: 'elanhome',
    pet: 'elanpet',
    elanpet: 'elanpet'
  };
  return aliases[normalized] || 'elanvisual';
}

function resolveConnectUrl() {
  return normalizeText(
    process.env.ELANKAV_CONNECT_URL ||
    process.env.CONNECT_API_URL ||
    DEFAULT_CONNECT_URL
  ).replace(/\/+$/, '');
}

function resolveInternalToken() {
  return normalizeText(
    process.env.CONNECT_INTERNAL_API_TOKEN ||
    process.env.CONNECT_INTERNAL_TOKEN ||
    process.env.CRM_INTERNAL_TOKEN
  );
}

async function fetchPublishedRuntime({ platform, fetchFn = globalThis.fetch } = {}) {
  if (typeof fetchFn !== 'function') {
    const error = new Error('FETCH_NOT_AVAILABLE');
    error.code = 'FETCH_NOT_AVAILABLE';
    throw error;
  }

  const token = resolveInternalToken();
  if (!token) {
    const error = new Error('CONNECT_INTERNAL_API_TOKEN_REQUIRED');
    error.code = 'CONNECT_INTERNAL_API_TOKEN_REQUIRED';
    throw error;
  }

  const platformId = normalizePlatform(platform);
  const response = await fetchFn(
    `${resolveConnectUrl()}/console/api/ai-platforms/runtime/${encodeURIComponent(platformId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-elankav-internal-token': token,
        'X-Elankav-Platform': 'ORCHESTRATOR',
        'X-Elankav-Actor-Type': 'system'
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message ||
      payload?.error ||
      `CONNECT_RUNTIME_HTTP_${response.status}`
    );
    error.code = payload?.error?.code || 'CONNECT_RUNTIME_REQUEST_FAILED';
    error.status = response.status;
    error.details = payload;
    throw error;
  }

  const instructions = normalizeText(payload?.platform?.instructions);
  if (!instructions) {
    const error = new Error('CONNECT_RUNTIME_INSTRUCTIONS_REQUIRED');
    error.code = 'CONNECT_RUNTIME_INSTRUCTIONS_REQUIRED';
    error.details = payload;
    throw error;
  }

  return {
    source: 'ELANKAV_CONNECT_RUNTIME',
    schemaVersion: payload?.schemaVersion || null,
    version: payload?.version || null,
    publishedAt: payload?.publishedAt || null,
    execution: payload?.execution || {},
    platform: payload?.platform || {},
    instructions,
    responseRules: payload?.platform?.responseRules || {},
    continuity: payload?.platform?.continuity || {},
    catalogAccess: payload?.platform?.catalogAccess || {}
  };
}

async function requirePublishedRuntime(input = {}) {
  const runtime = await fetchPublishedRuntime(input);
  if (runtime.execution?.shouldRespond !== true) {
    const error = new Error('CONNECT_RUNTIME_RESPONSES_DISABLED');
    error.code = 'CONNECT_RUNTIME_RESPONSES_DISABLED';
    error.runtime = runtime;
    throw error;
  }
  return runtime;
}

module.exports = {
  DEFAULT_CONNECT_URL,
  normalizePlatform,
  resolveConnectUrl,
  resolveInternalToken,
  fetchPublishedRuntime,
  requirePublishedRuntime
};
