'use strict';

const CONTRACT_VERSION = 'ELAN-AI-INT-001';
const DEFAULT_BASE_URL = 'http://127.0.0.1:4200';
const DEFAULT_TIMEOUT_MS = 2500;

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
}

function createRuntimeError(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

async function invokeElanAIRuntime({
  request,
  baseUrl = process.env.ELAN_AI_RUNTIME_URL,
  authToken = process.env.ELAN_AI_INTERNAL_TOKEN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = global.fetch
} = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('ELAN_AI_RUNTIME_REQUEST_REQUIRED');
  }

  if (typeof fetchImpl !== 'function') {
    throw new TypeError('ELAN_AI_RUNTIME_FETCH_REQUIRED');
  }

  const normalizedToken = String(authToken || '').trim();
  if (!normalizedToken) {
    throw createRuntimeError('ELAN_AI_RUNTIME_TOKEN_REQUIRED');
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_TIMEOUT_MS
  );

  try {
    const response = await fetchImpl(
      `${normalizeBaseUrl(baseUrl)}/v1/runtime/messages`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-ELAN-AI-Token': normalizedToken
        },
        body: JSON.stringify(request),
        signal: controller.signal
      }
    );
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw createRuntimeError(
        `ELAN_AI_RUNTIME_HTTP_${response.status}`,
        data
      );
    }

    if (
      !data ||
      data.version !== CONTRACT_VERSION ||
      data.requestId !== request.requestId
    ) {
      throw createRuntimeError('ELAN_AI_RUNTIME_CONTRACT_INVALID');
    }

    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createRuntimeError('ELAN_AI_RUNTIME_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  CONTRACT_VERSION,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  invokeElanAIRuntime,
  normalizeBaseUrl
};
