'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCustomerInstructions,
  getPublishedRuntime
} = require('../services/connectAiRuntimeService');

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

test('buildCustomerInstructions usa únicamente la autoridad publicada por CONNECT', () => {
  const result = buildCustomerInstructions({
    platform: {
      instructions: 'INSTRUCCIONES OFICIALES CONNECT',
      responseRules: { oneQuestion: true },
      continuity: { enabled: true },
      catalogAccess: { products: true }
    }
  });

  assert.match(result, /INSTRUCCIONES OFICIALES CONNECT/);
  assert.match(result, /"oneQuestion": true/);
  assert.match(result, /"enabled": true/);
  assert.match(result, /"products": true/);
  assert.doesNotMatch(result, /asesora comercial de ELANVISUAL/i);
  assert.doesNotMatch(result, /tintas de alta calidad/i);
  assert.doesNotMatch(result, /Tu secuencia comercial es/i);
});

test('buildCustomerInstructions falla cerrado si CONNECT no publica instrucciones', () => {
  assert.throws(
    () => buildCustomerInstructions({ platform: { instructions: '' } }),
    error => error && error.code === 'CONNECT_RUNTIME_INSTRUCTIONS_REQUIRED'
  );
});

test('getPublishedRuntime valida contrato e instrucciones de CONNECT', async () => {
  await withEnv({ CONNECT_INTERNAL_API_TOKEN: 'test-secret' }, async () => {
    let request = null;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return {
            schemaVersion: 'ELANKAV_AI_RUNTIME_V1',
            version: 4,
            publishedAt: '2026-08-07T23:00:00.000Z',
            execution: { shouldRespond: true },
            platform: {
              platformId: 'elanvisual',
              instructions: 'AUTORIDAD CONNECT',
              responseRules: {},
              continuity: {},
              catalogAccess: {}
            }
          };
        }
      };
    };

    const runtime = await getPublishedRuntime('ELANVISUAL', fetchImpl);

    assert.equal(runtime.version, 4);
    assert.equal(runtime.shouldRespond, true);
    assert.match(request.url, /\/runtime\/elanvisual$/);
    assert.equal(request.options.headers['X-Elankav-Internal-Token'], 'test-secret');
  });
});

test('getPublishedRuntime rechaza un contrato distinto al oficial', async () => {
  await withEnv({ CONNECT_INTERNAL_API_TOKEN: 'test-secret' }, async () => {
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return {
          schemaVersion: 'OTRO_RUNTIME',
          execution: { shouldRespond: true },
          platform: { instructions: 'texto' }
        };
      }
    });

    await assert.rejects(
      () => getPublishedRuntime('elanvisual', fetchImpl),
      error => error && error.code === 'CONNECT_RUNTIME_SCHEMA_INVALID'
    );
  });
});
