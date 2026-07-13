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
    measurementStatus: 'MISSING',
    measurements: [],
    directClientConversation: false
  };
}

test('sin URL mantiene modo stub seguro', async () => {
  const previous = process.env.DESIGN_ENGINE_URL;
  delete process.env.DESIGN_ENGINE_URL;

  try {
    const status = getDesignEngineConfigurationStatus();
    const result = await executeDesignRequest(validRequest());

    assert.equal(status.mode, 'stub');
    assert.equal(status.endpointConfigured, false);
    assert.equal(result.status, 'STUB_ACCEPTED');
    assert.equal(result.connected, false);
  } finally {
    if (previous === undefined) {
      delete process.env.DESIGN_ENGINE_URL;
    } else {
      process.env.DESIGN_ENGINE_URL = previous;
    }
  }
});

test('acepta únicamente solicitudes provenientes de ELAN IA', async () => {
  await assert.rejects(
    () => executeDesignRequest({
      actor: { source: 'CLIENT' }
    }),
    error =>
      error.code === 'DESIGN_ENTRY_SOURCE_INVALID'
  );
});

test('rechaza solicitudes inválidas', async () => {
  await assert.rejects(
    () => executeDesignRequest(null),
    error =>
      error.code === 'DESIGN_REQUEST_INVALID'
  );
});

test('con URL ejecuta POST y devuelve DesignResult real', async () => {
  const previous = process.env.DESIGN_ENGINE_URL;
  process.env.DESIGN_ENGINE_URL = 'http://127.0.0.1:4300';

  const fetchImpl = async (url, options) => {
    assert.equal(
      url,
      'http://127.0.0.1:4300/internal/design'
    );
    assert.equal(options.method, 'POST');

    const body = JSON.parse(options.body);
    assert.equal(body.actor.source, 'ELAN_IA');

    return {
      ok: true,
      status: 200,
      async json() {
        return {
          success: true,
          result: {
            status: 'PLANNED',
            platform: 'ELANVISUAL',
            warnings: [],
            elanIaResult: {
              conversational: false,
              clientReady: false
            }
          }
        };
      }
    };
  };

  try {
    const result = await executeDesignRequest(
      validRequest(),
      { fetchImpl }
    );

    assert.equal(result.mode, 'http');
    assert.equal(result.connected, true);
    assert.equal(result.status, 'PLANNED');
    assert.equal(result.conversational, false);
    assert.equal(result.result.platform, 'ELANVISUAL');
  } finally {
    if (previous === undefined) {
      delete process.env.DESIGN_ENGINE_URL;
    } else {
      process.env.DESIGN_ENGINE_URL = previous;
    }
  }
});

test('propaga rechazo estructurado del Design Engine', async () => {
  const previous = process.env.DESIGN_ENGINE_URL;
  process.env.DESIGN_ENGINE_URL = 'http://127.0.0.1:4300';

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

  try {
    await assert.rejects(
      () => executeDesignRequest(
        validRequest(),
        { fetchImpl }
      ),
      error =>
        error.code === 'PLATFORM_REQUIRED' &&
        error.status === 422
    );
  } finally {
    if (previous === undefined) {
      delete process.env.DESIGN_ENGINE_URL;
    } else {
      process.env.DESIGN_ENGINE_URL = previous;
    }
  }
});
