'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_OPERATIONS,
  OrchestratorClient
} = require('../src/orchestratorClient');

function response({ status = 200, data = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(data);
    }
  };
}

test('cliente permite únicamente contratos de lectura conocidos', () => {
  assert.deepEqual(Object.keys(ALLOWED_OPERATIONS), [
    'health',
    'dashboard',
    'projects',
    'ecosystem',
    'github',
    'docker'
  ]);
});

test('cliente consulta health con cabecera de identidad', async () => {
  let captured;

  const client = new OrchestratorClient({
    baseUrl: 'http://127.0.0.1:4100/',
    token: 'secret-token',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ data: { status: 'OK' } });
    }
  });

  const result = await client.request('health');

  assert.equal(result.status, 'OK');
  assert.equal(captured.url, 'http://127.0.0.1:4100/api/health');
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.options.headers.Authorization, 'Bearer secret-token');
  assert.equal(captured.options.headers['X-ELANKAV-CLIENT'], 'vscode-extension');
});

test('cliente rechaza operaciones no autorizadas', async () => {
  const client = new OrchestratorClient({
    baseUrl: 'http://127.0.0.1:4100',
    fetchImpl: async () => response()
  });

  await assert.rejects(
    () => client.request('restart-docker'),
    /ORCHESTRATOR_OPERATION_NOT_ALLOWED/
  );
});

test('cliente propaga error HTTP sin ocultarlo', async () => {
  const client = new OrchestratorClient({
    baseUrl: 'http://127.0.0.1:4100',
    fetchImpl: async () => response({
      status: 401,
      data: { error: 'UNAUTHORIZED' }
    })
  });

  await assert.rejects(
    () => client.request('dashboard'),
    error => error.message === 'ORCHESTRATOR_HTTP_401' && error.status === 401
  );
});
