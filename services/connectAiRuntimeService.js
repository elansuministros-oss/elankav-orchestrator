'use strict';

const {
  normalizePlatform,
  resolveConnectUrl
} = require('./connectPlatformKnowledgeService');

const DEFAULT_TIMEOUT_MS = 5000;

function normalizeText(value) {
  return String(value || '').trim();
}

function resolveInternalToken() {
  return normalizeText(
    process.env.CONNECT_INTERNAL_API_TOKEN ||
    process.env.CONNECT_INTERNAL_TOKEN ||
    process.env.CRM_INTERNAL_TOKEN
  );
}

function buildHeaders() {
  const token = resolveInternalToken();
  const headers = {
    Accept: 'application/json',
    'X-Elankav-Platform': 'ORCHESTRATOR',
    'X-Elankav-Actor-Type': 'system'
  };

  if (token) {
    headers['x-elankav-internal-token'] = token;
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function validateRuntime(payload, platformId) {
  if (!payload || typeof payload !== 'object') {
    const error = new Error('CONNECT_AI_RUNTIME_INVALID');
    error.code = 'CONNECT_AI_RUNTIME_INVALID';
    throw error;
  }

  if (payload.authority !== 'CONNECT_AI_PLATFORMS' || payload.authorityLocked !== true) {
    const error = new Error('CONNECT_AI_RUNTIME_AUTHORITY_MISMATCH');
    error.code = 'CONNECT_AI_RUNTIME_AUTHORITY_MISMATCH';
    throw error;
  }

  if (String(payload.platform?.platformId || '').toLowerCase() !== platformId) {
    const error = new Error('CONNECT_AI_RUNTIME_PLATFORM_MISMATCH');
    error.code = 'CONNECT_AI_RUNTIME_PLATFORM_MISMATCH';
    throw error;
  }

  return payload;
}

async function fetchConnectAiRuntime({ platform, fetchFn = globalThis.fetch } = {}) {
  if (typeof fetchFn !== 'function') {
    const error = new Error('FETCH_NOT_AVAILABLE');
    error.code = 'FETCH_NOT_AVAILABLE';
    throw error;
  }

  const token = resolveInternalToken();
  if (!token) {
    const error = new Error('CONNECT_AI_RUNTIME_TOKEN_REQUIRED');
    error.code = 'CONNECT_AI_RUNTIME_TOKEN_REQUIRED';
    throw error;
  }

  const platformId = normalizePlatform(platform);
  const response = await fetchFn(
    `${resolveConnectUrl()}/console/api/ai-platforms/runtime/${encodeURIComponent(platformId)}`,
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
      `CONNECT_AI_RUNTIME_HTTP_${response.status}`
    );
    error.code = payload?.error?.code || 'CONNECT_AI_RUNTIME_REQUEST_FAILED';
    error.status = response.status;
    error.details = payload;
    throw error;
  }

  return validateRuntime(payload, platformId);
}

async function loadConnectAiRuntimeSafely(input = {}) {
  try {
    const runtime = await fetchConnectAiRuntime(input);
    return {
      available: true,
      authority: runtime.authority,
      authorityLocked: runtime.authorityLocked === true,
      runtime
    };
  } catch (error) {
    console.error('[CONNECT_AI_RUNTIME_UNAVAILABLE]', {
      code: error?.code || null,
      status: error?.status || null,
      message: error?.message || String(error)
    });

    return {
      available: false,
      authority: 'CONNECT_AI_PLATFORMS',
      authorityLocked: true,
      runtime: null,
      error: error?.code || error?.message || 'CONNECT_AI_RUNTIME_UNAVAILABLE'
    };
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  buildHeaders,
  fetchConnectAiRuntime,
  loadConnectAiRuntimeSafely,
  resolveInternalToken,
  validateRuntime
};
