'use strict';

const DEFAULT_BASE_URL = 'http://127.0.0.1:4300';
const DEFAULT_TIMEOUT_MS = 5000;

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function createConnectError(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

class ConnectClient {
  constructor({
    baseUrl = process.env.ELANKAV_CONNECT_URL,
    internalToken = process.env.ELANKAV_CONNECT_INTERNAL_TOKEN,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = global.fetch
  } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('CONNECT_FETCH_REQUIRED');
    }

    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.internalToken = String(internalToken || '').trim();
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_TIMEOUT_MS;
    this.fetchImpl = fetchImpl;
  }

  async request({ method = 'GET', path, query, body } = {}) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath.startsWith('/api/')) {
      throw new TypeError('CONNECT_PATH_INVALID');
    }

    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      Accept: 'application/json',
      'X-Elankav-Platform': 'elan-ai',
      'X-Elankav-Actor-Type': 'orchestrator'
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.internalToken) {
      headers.Authorization = `Bearer ${this.internalToken}`;
    }

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw createConnectError(`CONNECT_HTTP_${response.status}`, data);
      }

      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw createConnectError('CONNECT_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  ConnectClient,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  createConnectError,
  normalizeBaseUrl
};
