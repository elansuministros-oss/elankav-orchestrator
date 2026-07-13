'use strict';

const DESIGN_ENGINE_PROVIDER = 'ELANKAV Design Engine';
const DESIGN_ENGINE_VERSION = '0.1.0';
const DEFAULT_TIMEOUT_MS = 130000;

function resolveDesignEngineUrl() {
  const value = String(process.env.DESIGN_ENGINE_URL || '').trim();
  return value ? value.replace(/\/+$/, '') : null;
}

function getDesignEngineConfigurationStatus() {
  const endpoint = resolveDesignEngineUrl();

  return Object.freeze({
    available: true,
    configured: Boolean(endpoint),
    endpointConfigured: Boolean(endpoint),
    connected: false,
    provider: DESIGN_ENGINE_PROVIDER,
    version: DESIGN_ENGINE_VERSION,
    mode: endpoint ? 'http' : 'stub',
    endpoint,
    externalExecutionEnabled: Boolean(endpoint),
  });
}

function validateDesignRequest(request) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request)
  ) {
    const error = new TypeError(
      'Design Engine requiere una solicitud válida'
    );
    error.code = 'DESIGN_REQUEST_INVALID';
    throw error;
  }

  if (request.actor?.source !== 'ELAN_IA') {
    const error = new Error(
      'La entrada debe provenir de ELAN IA'
    );
    error.code = 'DESIGN_ENTRY_SOURCE_INVALID';
    throw error;
  }
}

function createStubResult(request) {
  return Object.freeze({
    status: 'STUB_ACCEPTED',
    provider: DESIGN_ENGINE_PROVIDER,
    version: DESIGN_ENGINE_VERSION,
    mode: 'stub',
    connected: false,
    conversational: false,
    requestId: request.requestId || null,
    platform: request.platform || null,
    result: null,
    warnings: Object.freeze([
      'DESIGN_ENGINE_URL no está configurada; se conservó el fallback controlado.'
    ])
  });
}

async function executeHttpDesignRequest(
  request,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}
) {
  const endpoint = resolveDesignEngineUrl();

  if (!endpoint) {
    return createStubResult(request);
  }

  if (typeof fetchImpl !== 'function') {
    const error = new Error('No existe cliente HTTP disponible');
    error.code = 'DESIGN_HTTP_CLIENT_UNAVAILABLE';
    throw error;
  }

  let response;

  try {
    response = await fetchImpl(
      `${endpoint}/internal/design`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs)
      }
    );
  } catch (cause) {
    const error = new Error(
      'No fue posible conectar con ELANKAV Design Engine'
    );
    error.code =
      cause?.name === 'TimeoutError' ||
      cause?.name === 'AbortError'
        ? 'DESIGN_ENGINE_TIMEOUT'
        : 'DESIGN_ENGINE_UNAVAILABLE';
    error.cause = cause;
    throw error;
  }

  let payload;

  try {
    payload = await response.json();
  } catch (cause) {
    const error = new Error(
      'Design Engine devolvió una respuesta inválida'
    );
    error.code = 'DESIGN_ENGINE_RESPONSE_INVALID';
    error.cause = cause;
    throw error;
  }

  if (!response.ok || payload.success !== true) {
    const error = new Error(
      payload.message || 'Design Engine rechazó la solicitud'
    );
    error.code =
      payload.error || 'DESIGN_ENGINE_REQUEST_REJECTED';
    error.status = response.status;
    throw error;
  }

  const result = payload.result;

  if (!result || typeof result !== 'object') {
    const error = new Error(
      'Design Engine no devolvió un DesignResult válido'
    );
    error.code = 'DESIGN_ENGINE_RESPONSE_INVALID';
    throw error;
  }

  return Object.freeze({
    status: result.status || 'UNKNOWN',
    provider: DESIGN_ENGINE_PROVIDER,
    version: DESIGN_ENGINE_VERSION,
    mode: 'http',
    connected: true,
    conversational:
      result.elanIaResult?.conversational === true,
    requestId: request.requestId || null,
    platform: result.platform || request.platform || null,
    result,
    warnings: Object.freeze(
      Array.isArray(result.warnings)
        ? [...result.warnings]
        : []
    )
  });
}

async function executeDesignRequest(request = {}, options = {}) {
  validateDesignRequest(request);
  return executeHttpDesignRequest(request, options);
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DESIGN_ENGINE_PROVIDER,
  DESIGN_ENGINE_VERSION,
  executeDesignRequest,
  getDesignEngineConfigurationStatus,
  resolveDesignEngineUrl
};
