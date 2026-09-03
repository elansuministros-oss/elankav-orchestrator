'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchConnectAiRuntime,
  validateRuntime
} = require('../services/connectAiRuntimeService');

function runtime(overrides = {}) {
  return {
    authority: 'CONNECT_AI_PLATFORMS',
    authorityLocked: true,
    schemaVersion: 'ELANKAV_AI_RUNTIME_V1',
    version: 4,
    execution: {
      globalEnabled: true,
      platformEnabled: true,
      shouldRespond: true,
      source: 'CONNECT_LIVE_CONTROL'
    },
    platform: {
      platformId: 'elanvisual',
      responsesEnabled: true,
      initialMessage: 'Hola, soy ELAN IA de ELANVISUAL.',
      instructions: 'Vendé usando información oficial.',
      responseRules: {},
      continuity: { enabled: true, historyLimit: 20 },
      catalogAccess: { enabled: true, onlyPublished: true }
    },
    ...overrides
  };
}

test('consulta exclusivamente el runtime publicado/controlado por CONNECT', async () => {
  const previous = process.env.CONNECT_INTERNAL_API_TOKEN;
  process.env.CONNECT_INTERNAL_API_TOKEN = 'runtime-test-token-123456';
  let requestedUrl = null;
  let requestedHeaders = null;

  try {
    const result = await fetchConnectAiRuntime({
      platform: 'ELANVISUAL',
      fetchFn: async (url, options) => {
        requestedUrl = String(url);
        requestedHeaders = options.headers;
        return new Response(JSON.stringify(runtime()), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    assert.match(requestedUrl, /\/console\/api\/ai-platforms\/runtime\/elanvisual$/);
    assert.equal(requestedHeaders['x-elankav-internal-token'], 'runtime-test-token-123456');
    assert.equal(result.authority, 'CONNECT_AI_PLATFORMS');
    assert.equal(result.authorityLocked, true);
    assert.equal(result.execution.shouldRespond, true);
  } finally {
    if (previous === undefined) delete process.env.CONNECT_INTERNAL_API_TOKEN;
    else process.env.CONNECT_INTERNAL_API_TOKEN = previous;
  }
});

test('rechaza cualquier autoridad paralela', () => {
  assert.throws(
    () => validateRuntime({
      ...runtime(),
      authority: 'ORCHESTRATOR_LOCAL'
    }, 'elanvisual'),
    /CONNECT_AI_RUNTIME_AUTHORITY_MISMATCH/
  );
});
