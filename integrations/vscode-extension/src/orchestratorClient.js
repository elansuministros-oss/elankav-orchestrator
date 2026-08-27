'use strict';

const ALLOWED_OPERATIONS = Object.freeze({
  health: '/api/health',
  dashboard: '/api/dashboard',
  projects: '/api/projects',
  ecosystem: '/api/ecosystem',
  github: '/api/github',
  docker: '/api/docker'
});

class OrchestratorClient {
  constructor({ baseUrl, token = '', timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('OrchestratorClient requiere una implementación fetch');
    }

    const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');

    if (!normalizedBaseUrl) {
      throw new Error('ORCHESTRATOR_URL_REQUIRED');
    }

    this.baseUrl = normalizedBaseUrl;
    this.token = String(token || '').trim();
    this.timeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 15000;
    this.fetchImpl = fetchImpl;
  }

  async request(operation) {
    const path = ALLOWED_OPERATIONS[operation];

    if (!path) {
      throw new Error(`ORCHESTRATOR_OPERATION_NOT_ALLOWED:${operation}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = {
        Accept: 'application/json',
        'X-ELANKAV-CLIENT': 'vscode-extension'
      };

      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      const text = await response.text();
      let data;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`ORCHESTRATOR_INVALID_JSON:${response.status}`);
      }

      if (!response.ok) {
        const error = new Error(`ORCHESTRATOR_HTTP_${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('ORCHESTRATOR_TIMEOUT');
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  ALLOWED_OPERATIONS,
  OrchestratorClient
};
