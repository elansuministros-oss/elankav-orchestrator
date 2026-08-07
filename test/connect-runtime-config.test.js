'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchPublishedRuntime,
  requirePublishedRuntime
} = require('../services/connectRuntimeConfigService');

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('consulta el runtime publicado de CONNECT con token interno', async () => {
  await withEnv({
    ELANKAV_CONNECT_URL: 'https://connect.example.test',
    CONNECT_INTERNAL_API_TOKEN: 'secret-token'
  }, async () => {
    let request = null;
    const fetchFn = async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return {
            schemaVersion: 'ELANKAV_AI_RUNTIME_V1',
            version: 9,
            publishedAt: '2026-08-07T23:00:00.000Z',
            execution: { globalEnabled: true, platformEnabled: true, shouldRespond: true },
            platform: {
              platformId: 'elanvisual',
              instructions: 'INSTRUCCIONES OFICIALES CONNECT',
              responseRules: { oneQuestion: true },
              continuity: { enabled: true },
              catalogAccess: { products: true }
            }
          };
        }
      };
    };

    const runtime = await fetchPublishedRuntime({ platform: 'ELANVISUAL', fetchFn });

    assert.equal(request.url, 'https://connect.example.test/console/api/ai-platforms/runtime/elanvisual');
    assert.equal(request.options.headers['x-elankav-internal-token'], 'secret-token');
    assert.equal(runtime.instructions, 'INSTRUCCIONES OFICIALES CONNECT');
    assert.equal(runtime.version, 9);
  });
});

test('falla cerrado si CONNECT no autoriza respuestas', async () => {
  await withEnv({ CONNECT_INTERNAL_API_TOKEN: 'secret-token' }, async () => {
    const fetchFn = async () => ({
      ok: true,
      async json() {
        return {
          schemaVersion: 'ELANKAV_AI_RUNTIME_V1',
          version: 2,
          execution: { globalEnabled: false, platformEnabled: true, shouldRespond: false },
          platform: { platformId: 'elanvisual', instructions: 'No responder' }
        };
      }
    });

    await assert.rejects(
      () => requirePublishedRuntime({ platform: 'elanvisual', fetchFn }),
      error => error && error.code === 'CONNECT_RUNTIME_RESPONSES_DISABLED'
    );
  });
});

test('no inventa instrucciones locales si CONNECT no entrega instrucciones', async () => {
  await withEnv({ CONNECT_INTERNAL_API_TOKEN: 'secret-token' }, async () => {
    const fetchFn = async () => ({
      ok: true,
      async json() {
        return {
          schemaVersion: 'ELANKAV_AI_RUNTIME_V1',
          version: 3,
          execution: { shouldRespond: true },
          platform: { platformId: 'elanvisual', instructions: '' }
        };
      }
    });

    await assert.rejects(
      () => fetchPublishedRuntime({ platform: 'elanvisual', fetchFn }),
      error => error && error.code === 'CONNECT_RUNTIME_INSTRUCTIONS_REQUIRED'
    );
  });
});
