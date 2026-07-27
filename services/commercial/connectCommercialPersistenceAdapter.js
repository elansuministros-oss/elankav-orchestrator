'use strict';

const DEFAULT_CONNECT_BASE_URL = 'https://connect.elankav.com';
const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_CONNECT_BASE_URL).trim().replace(/\/+$/, '');
}

function buildHeaders(apiKey) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['X-Api-Key'] = apiKey;
  }
  return headers;
}

function createConnectCommercialPersistenceAdapter({
  baseUrl = process.env.CONNECT_BASE_URL || process.env.ELANKAV_CONNECT_URL,
  apiKey = process.env.CONNECT_API_KEY || process.env.ELANKAV_CONNECT_API_KEY,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  const headers = buildHeaders(apiKey);

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${resolvedBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        payload?.message || payload?.error || `CONNECT_COMMERCIAL_HTTP_${response.status}`
      );
      error.code = 'CONNECT_COMMERCIAL_REQUEST_FAILED';
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload?.data ?? payload;
  }

  return Object.freeze({
    async getConversationControl({ conversationRef }) {
      const encoded = encodeURIComponent(conversationRef);
      return request(`/api/v1/commercial/conversations/${encoded}/control`);
    },

    async saveConversationControl(input) {
      const encoded = encodeURIComponent(input.conversationRef);
      return request(`/api/v1/commercial/conversations/${encoded}/control`, {
        method: 'PUT',
        body: input
      });
    },

    async createFollowUp(input) {
      return request('/api/v1/commercial/follow-ups', {
        method: 'POST',
        body: input
      });
    },

    async recordCommercialObservation(input) {
      return request('/api/v1/commercial/observations', {
        method: 'POST',
        body: input
      });
    }
  });
}

module.exports = {
  DEFAULT_CONNECT_BASE_URL,
  createConnectCommercialPersistenceAdapter
};