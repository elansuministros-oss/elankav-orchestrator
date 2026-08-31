'use strict';

const DEFAULT_CONNECT_BASE_URL = 'https://connect.elankav.com';

class ConnectMarketplaceToolError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function createConnectMarketplaceToolAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = clean(env.CONNECT_BASE_URL || DEFAULT_CONNECT_BASE_URL).replace(/\/+$/, '');
  const token = clean(
    env.MARKETPLACE_RUNTIME_TOKEN ||
    env.VQS_API_TOKEN ||
    env.CONNECT_MARKETPLACE_TOKEN
  );

  function headers() {
    if (!token) {
      throw new ConnectMarketplaceToolError(
        'CONNECT_MARKETPLACE_TOKEN_REQUIRED',
        'No existe un token interno configurado para las herramientas comerciales de CONNECT.',
        503
      );
    }

    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Elankav-Marketplace-Token': token,
      'X-Elankav-Actor-Role': 'owner',
      'X-Elankav-Actor-Id': 'ELAN_OPENAI_TOOL_RUNTIME',
      'X-Elankav-Source': 'ELAN_OPENAI_TOOL_RUNTIME'
    };
  }

  async function request(path, init = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          ...headers(),
          ...(init.headers || {})
        }
      });
    } catch (error) {
      throw new ConnectMarketplaceToolError(
        'CONNECT_TOOL_TRANSPORT_ERROR',
        error instanceof Error ? error.message : 'No fue posible contactar CONNECT.',
        502
      );
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorPayload =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload.error
          : null;
      const code =
        errorPayload && typeof errorPayload === 'object'
          ? clean(errorPayload.code)
          : '';
      const message =
        errorPayload && typeof errorPayload === 'object'
          ? clean(errorPayload.message)
          : '';

      throw new ConnectMarketplaceToolError(
        code || 'CONNECT_TOOL_REQUEST_FAILED',
        message || `CONNECT respondió HTTP ${response.status}.`,
        response.status
      );
    }

    return payload;
  }

  async function getContactCapabilities() {
    return request('/api/v1/marketplace/contact-capabilities', {
      method: 'GET'
    });
  }

  async function executeContactNext(caseCode) {
    const normalized = clean(caseCode).toUpperCase();
    if (!normalized) {
      throw new ConnectMarketplaceToolError(
        'CONTACT_CASE_CODE_REQUIRED',
        'case_code es obligatorio.',
        400
      );
    }

    return request(
      `/api/v1/marketplace/contact-execution/${encodeURIComponent(normalized)}/execute-next`,
      { method: 'POST', body: '{}' }
    );
  }

  return Object.freeze({
    getContactCapabilities,
    executeContactNext
  });
}

module.exports = {
  DEFAULT_CONNECT_BASE_URL,
  ConnectMarketplaceToolError,
  createConnectMarketplaceToolAdapter
};
