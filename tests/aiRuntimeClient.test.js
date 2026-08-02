'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_PLATFORMS,
  normalizePlatform,
  getConfiguration,
  loadPublishedRuntime,
  loadOfficialCatalogContext
} = require('../services/aiRuntimeClient');

test('solo reconoce plataformas publicas autorizadas', () => {
  assert.deepEqual(PUBLIC_PLATFORMS, ['elanvisual', 'elanhome', 'elanpet']);
  assert.equal(normalizePlatform('ELAN_VISUAL'), 'elan-visual');
  assert.equal(normalizePlatform(' ELANHOME '), 'elanhome');
});

test('rechaza CONNECT como plataforma publica', async () => {
  await assert.rejects(
    () => loadPublishedRuntime('connect', { env: { CONNECT_INTERNAL_API_TOKEN: 'token' }, fetchImpl: async () => { throw new Error('no debe llamar fetch'); } }),
    error => error.message === 'AI_RUNTIME_PLATFORM_NOT_PUBLIC'
  );
});

test('exige token interno para consultar runtime publicado', async () => {
  await assert.rejects(
    () => loadPublishedRuntime('elanvisual', { env: {}, fetchImpl: async () => { throw new Error('no debe llamar fetch'); } }),
    error => error.message === 'CONNECT_INTERNAL_API_TOKEN_REQUIRED'
  );
});

test('consulta runtime publicado con token y plataforma correcta', async () => {
  let request;
  const payload = { version: 4, execution: { shouldRespond: false } };
  const result = await loadPublishedRuntime('ELANVISUAL', {
    env: {
      CONNECT_BASE_URL: 'https://connect.example.com/',
      CONNECT_INTERNAL_API_TOKEN: 'secret',
      CONNECT_AI_RUNTIME_TIMEOUT_MS: '2500'
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, async json() { return payload; } };
    }
  });

  assert.deepEqual(result, payload);
  assert.equal(request.url, 'https://connect.example.com/console/api/ai-platforms/runtime/elanvisual');
  assert.equal(request.options.headers['x-elankav-internal-token'], 'secret');
});

test('propaga error HTTP estructurado desde CONNECT', async () => {
  await assert.rejects(
    () => loadPublishedRuntime('elanpet', {
      env: { CONNECT_INTERNAL_API_TOKEN: 'secret' },
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        async json() { return { error: { code: 'AI_RUNTIME_NOT_PUBLISHED' } }; }
      })
    }),
    error => error.message === 'AI_RUNTIME_NOT_PUBLISHED' && error.status === 503
  );
});

test('consulta contexto oficial por plataforma y mensaje', async () => {
  let requestedUrl;
  const result = await loadOfficialCatalogContext('elanhome', 'cocina integral', {
    env: { CONNECT_BASE_URL: 'https://connect.example.com' },
    fetchImpl: async url => {
      requestedUrl = url;
      return { ok: true, async json() { return { platformId: 'elanhome' }; } };
    }
  });

  assert.equal(result.platformId, 'elanhome');
  assert.equal(requestedUrl, 'https://connect.example.com/console/api/ai-platforms/elanhome/context?q=cocina%20integral');
});

test('normaliza configuracion del cliente', () => {
  assert.deepEqual(getConfiguration({ CONNECT_URL: 'https://connect.example.com///', CONNECT_INTERNAL_API_TOKEN: ' x ', CONNECT_AI_RUNTIME_TIMEOUT_MS: '9000' }), {
    baseUrl: 'https://connect.example.com',
    token: 'x',
    timeoutMs: 9000
  });
});
