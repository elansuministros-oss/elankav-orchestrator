'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeDesignRequest,
  getDesignEngineConfigurationStatus
} = require('../adapters/designEngineAdapter');

function validRequest() {
  return {
    requestId: 'DESIGN-REQ-001',
    actor: { source: 'ELAN_IA' },
    platform: 'ELANVISUAL',
    projectType: 'Rótulo exterior',
    measurementStatus: 'MISSING',
    measurements: [],
    instructions: ['Fondo negro y letras blancas'],
    directClientConversation: false
  };
}

function withDesignEngineUrl(value, callback) {
  const previous = process.env.DESIGN_ENGINE_URL;

  if (value === null) {
    delete process.env.DESIGN_ENGINE_URL;
  } else {
    process.env.DESIGN_ENGINE_URL = value;
  }

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (previous === undefined) {
        delete process.env.DESIGN_ENGINE_URL;
      } else {
        process.env.DESIGN_ENGINE_URL = previous;
      }
    });
}

test('sin URL mantiene modo stub seguro', async () => {
  await withDesignEngineUrl(null, async () => {
    const status = getDesignEngineConfigurationStatus();
    const result = await executeDesignRequest(validRequest());

    assert.equal(status.mode, 'stub');
    assert.equal(status.endpointConfigured, false);
    assert.equal(status.externalExecutionEnabled, false);
    assert.equal(result.status, 'STUB_ACCEPTED');
    assert.equal(result.connected, false);
  });
});

test('acepta únicamente solicitudes provenientes de ELAN IA', async () => {
  await assert.rejects(
    () => executeDesignRequest({ actor: { source: 'CLIENT' } }),
    error => error.code === 'DESIGN_ENTRY_SOURCE_INVALID'
  );
});

test('rechaza solicitudes inválidas', async () => {
  await assert.rejects(
    () => executeDesignRequest(null),
    error => error.code === 'DESIGN_REQUEST_INVALID'
  );
});

test('con URL devuelve DesignResult procesado con asset', async () => {
  await withDesignEngineUrl(
    'http://127.0.0.1:4300',
    async () => {
      const assetId = '44444444-4444-4444-8444-444444444444';
      const fetchImpl = async (url, options) => {
        assert.equal(
          url,
          'http://127.0.0.1:4300/internal/design'
        );
        assert.equal(options.method, 'POST');
        assert.equal(JSON.parse(options.body).actor.source, 'ELAN_IA');

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              success: true,
              result: {
                designId: assetId,
                status: 'PROCESSED',
                platform: 'ELANVISUAL',
                assets: [{
                  id: assetId,
                  type: 'IMAGE',
                  mimeType: 'image/png',
                  platform: 'ELANVISUAL',
                  url: `https://orchestrator.elankav.com/api/design-assets/${assetId}`
                }],
                warnings: [],
                qa: { approved: true },
                elanIaResult: {
                  conversational: false,
                  clientReady: true
                }
              }
            };
          }
        };
      };

      const result = await executeDesignRequest(
        validRequest(),
        { fetchImpl }
      );

      assert.equal(result.mode, 'http');
      assert.equal(result.connected, true);
      assert.equal(result.status, 'PROCESSED');
      assert.equal(result.result.assets.length, 1);
      assert.equal(result.result.elanIaResult.clientReady, true);
    }
  );
});

test('propaga rechazo estructurado del Design Engine', async () => {
  await withDesignEngineUrl(
    'http://127.0.0.1:4300',
    async () => {
      const fetchImpl = async () => ({
        ok: false,
        status: 422,
        async json() {
          return {
            success: false,
            error: 'PLATFORM_REQUIRED',
            message: 'La plataforma es obligatoria.'
          };
        }
      });

      await assert.rejects(
        () => executeDesignRequest(validRequest(), { fetchImpl }),
        error =>
          error.code === 'PLATFORM_REQUIRED' &&
          error.status === 422
      );
    }
  );
});
