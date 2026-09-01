'use strict';

const DEFAULT_CONNECT_BASE_URL = 'https://connect.elankav.com';
const DEFAULT_TIMEOUT_MS = 12_000;

class ConnectCommercialIntelligenceError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'ConnectCommercialIntelligenceError';
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function createConnectCommercialIntelligenceAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = clean(env.CONNECT_BASE_URL || DEFAULT_CONNECT_BASE_URL).replace(/\/+$/, '');
  const token = clean(env.CONNECT_INTERNAL_API_TOKEN || env.CONNECT_INTERNAL_TOKEN);
  const timeoutMs = Number(env.CONNECT_COMMERCIAL_INTELLIGENCE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  function headers() {
    if (!token) {
      throw new ConnectCommercialIntelligenceError(
        'CONNECT_INTERNAL_API_TOKEN_REQUIRED',
        'No existe token interno configurado para consultar CONNECT.',
        503
      );
    }

    return {
      Accept: 'application/json',
      'X-Elankav-Internal-Token': token,
      'X-Elankav-Source': 'ELAN_WHATSAPP_COMMERCIAL_INTELLIGENCE'
    };
  }

  async function request(path, filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (clean(value)) params.set(key, clean(value));
    }
    const query = params.toString();

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}${query ? `?${query}` : ''}`, {
        method: 'GET',
        headers: headers(),
        signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS)
      });
    } catch (error) {
      throw new ConnectCommercialIntelligenceError(
        'CONNECT_COMMERCIAL_INTELLIGENCE_TRANSPORT_ERROR',
        error instanceof Error ? error.message : 'No fue posible contactar CONNECT.',
        502
      );
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true) {
      const apiError = payload && typeof payload === 'object' ? payload.error : null;
      throw new ConnectCommercialIntelligenceError(
        clean(apiError?.code) || 'CONNECT_COMMERCIAL_INTELLIGENCE_REQUEST_FAILED',
        clean(apiError?.message) || `CONNECT respondió HTTP ${response.status}.`,
        response.status
      );
    }

    return payload;
  }

  return Object.freeze({
    getBriefing: filters => request('/api/v1/commercial-intelligence/briefing', filters),
    getReport: filters => request('/api/v1/commercial-intelligence/report', filters)
  });
}

module.exports = {
  DEFAULT_CONNECT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  ConnectCommercialIntelligenceError,
  createConnectCommercialIntelligenceAdapter
};
