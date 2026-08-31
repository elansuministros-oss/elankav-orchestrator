'use strict';

const DEFAULT_CONNECT_BASE_URL = 'https://connect.elankav.com';

class ConnectChannelToolError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function createConnectChannelToolAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = clean(env.CONNECT_BASE_URL || DEFAULT_CONNECT_BASE_URL).replace(/\/+$/, '');
  const token = clean(
    env.CONNECT_INTERNAL_API_TOKEN ||
    env.CONNECT_INTERNAL_TOKEN
  );

  function headers() {
    if (!token) {
      throw new ConnectChannelToolError(
        'CONNECT_INTERNAL_API_TOKEN_REQUIRED',
        'No existe token interno global configurado para CONNECT.',
        503
      );
    }

    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Elankav-Internal-Token': token,
      'X-Elankav-Source': 'ELAN_OPENAI_CHANNEL_RUNTIME'
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
      throw new ConnectChannelToolError(
        'CONNECT_CHANNEL_TRANSPORT_ERROR',
        error instanceof Error ? error.message : 'No fue posible contactar CONNECT.',
        502
      );
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const apiError =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload.error
          : null;
      throw new ConnectChannelToolError(
        clean(apiError?.code) || 'CONNECT_CHANNEL_REQUEST_FAILED',
        clean(apiError?.message) || `CONNECT respondió HTTP ${response.status}.`,
        response.status
      );
    }
    return payload;
  }

  async function getChannelCapabilities() {
    return request('/api/v1/channels/capabilities', { method: 'GET' });
  }

  return Object.freeze({ getChannelCapabilities });
}

module.exports = {
  DEFAULT_CONNECT_BASE_URL,
  ConnectChannelToolError,
  createConnectChannelToolAdapter
};
