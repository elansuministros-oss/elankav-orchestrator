'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const DEFAULT_TIMEOUT_MS = 10000;

class ConnectCommercialIntelligenceError extends Error {
  constructor(code, message, status = 502, details = null) {
    super(message || code || 'CONNECT_COMMERCIAL_INTELLIGENCE_ERROR');
    this.name = 'ConnectCommercialIntelligenceError';
    this.code = code || 'CONNECT_COMMERCIAL_INTELLIGENCE_ERROR';
    this.status = status;
    this.details = details;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function resolveConnectUrl(env = process.env) {
  return clean(
    env.ELANKAV_CONNECT_URL ||
    env.CONNECT_BASE_URL ||
    env.CONNECT_URL ||
    env.CONNECT_API_URL ||
    DEFAULT_CONNECT_URL
  ).replace(/\/+$/, '');
}

function resolveConnectToken(env = process.env) {
  return clean(
    env.CONNECT_INTERNAL_API_TOKEN ||
    env.CONNECT_INTERNAL_TOKEN ||
    env.ELANKAV_CONNECT_INTERNAL_TOKEN ||
    env.ORCHESTRATOR_INTERNAL_TOKEN ||
    env.CRM_INTERNAL_TOKEN
  );
}

function buildHeaders(env = process.env) {
  const token = resolveConnectToken(env);
  if (!token) {
    throw new ConnectCommercialIntelligenceError(
      'CONNECT_INTERNAL_TOKEN_REQUIRED',
      'No está configurada la credencial interna de CONNECT.',
      503
    );
  }

  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Elankav-Internal-Token': token,
    'X-Elankav-Platform': 'ORCHESTRATOR',
    'X-Elankav-Actor-Type': 'owner',
    'X-Elankav-Source': 'OWNER_COMMERCIAL_INTELLIGENCE'
  };
}

function appendFilter(params, key, value) {
  const normalized = clean(value);
  if (normalized) params.set(key, normalized);
}

function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  appendFilter(params, 'from', filters.from);
  appendFilter(params, 'to', filters.to);
  appendFilter(params, 'businessUnit', filters.businessUnit);
  appendFilter(params, 'platform', filters.platform);
  appendFilter(params, 'channel', filters.channel);
  appendFilter(params, 'source', filters.source);
  appendFilter(params, 'campaign', filters.campaign);
  const query = params.toString();
  return query ? `?${query}` : '';
}

function createConnectCommercialIntelligenceAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ConnectCommercialIntelligenceError(
      'FETCH_NOT_AVAILABLE',
      'No existe transporte HTTP disponible.',
      500
    );
  }

  const baseUrl = resolveConnectUrl(env);

  async function request(resource, filters = {}) {
    let response;
    try {
      response = await fetchImpl(
        `${baseUrl}/api/v1/commercial-intelligence/${resource}${buildQuery(filters)}`,
        {
          method: 'GET',
          headers: buildHeaders(env),
          signal: AbortSignal.timeout(timeoutMs)
        }
      );
    } catch (error) {
      if (error instanceof ConnectCommercialIntelligenceError) throw error;
      throw new ConnectCommercialIntelligenceError(
        'CONNECT_COMMERCIAL_INTELLIGENCE_TRANSPORT_ERROR',
        error?.message || 'No fue posible consultar CONNECT.',
        502
      );
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      const apiError = payload?.error && typeof payload.error === 'object'
        ? payload.error
        : null;
      throw new ConnectCommercialIntelligenceError(
        clean(apiError?.code) || clean(payload?.code) || 'CONNECT_COMMERCIAL_INTELLIGENCE_REQUEST_FAILED',
        clean(apiError?.message) || clean(payload?.message) || `CONNECT respondió HTTP ${response.status}.`,
        response.status,
        payload
      );
    }

    return payload;
  }

  return Object.freeze({
    getBriefing(filters = {}) {
      return request('briefing', filters);
    },
    getReport(filters = {}) {
      return request('report', filters);
    }
  });
}

module.exports = {
  DEFAULT_CONNECT_URL,
  DEFAULT_TIMEOUT_MS,
  ConnectCommercialIntelligenceError,
  buildHeaders,
  buildQuery,
  createConnectCommercialIntelligenceAdapter,
  resolveConnectToken,
  resolveConnectUrl
};
