'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDesignRequest,
  processDesignRequest
} = require('../services/designEngineService');

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

test('construye DesignRequest con entrada exclusiva de ELAN IA', () => {
  const request = buildDesignRequest({
    requestId: 'REQ-001',
    identityId: 'IDENTITY-001',
    phone: '+50578828089',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    message: 'Quiero un diseño para un rótulo'
  });

  assert.equal(request.actor.source, 'ELAN_IA');
  assert.equal(request.platform, 'ELANVISUAL');
  assert.equal(request.directClientConversation, false);
  assert.deepEqual(request.instructions, [
    'Quiero un diseño para un rótulo'
  ]);
});

test('rechaza solicitud de diseño sin plataforma', () => {
  assert.throws(
    () => buildDesignRequest({ message: 'Diseñame un rótulo' }),
    error => error.code === 'DESIGN_PLATFORM_REQUIRED'
  );
});

test('rechaza solicitud de diseño sin mensaje', () => {
  assert.throws(
    () => buildDesignRequest({ platform: 'ELANVISUAL' }),
    error => error.code === 'DESIGN_MESSAGE_REQUIRED'
  );
});

test('procesa solicitud real con asset', async () => {
  await withDesignEngineUrl(
    'http://127.0.0.1:4300',
    async () => {
      const assetId = '55555555-5555-4555-8555-555555555555';
      const response = await processDesignRequest(
        {
          requestId: 'REQ-002',
          identityId: 'IDENTITY-002',
          phone: '+50578828089',
          platform: 'ELANVISUAL',
          channel: 'whatsapp',
          message: 'Necesito una propuesta de fachada'
        },
        {
          fetchImpl: async () => ({
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
                  qa: { approved: true },
                  elanIaResult: {
                    clientReady: true,
                    conversational: false
                  }
                }
              };
            }
          })
        }
      );

      assert.equal(response.handled, true);
      assert.equal(response.connected, true);
      assert.equal(response.processed, true);
      assert.equal(response.designResult.assets.length, 1);
      assert.equal(
        response.outputText,
        'Preparé una propuesta visual para tu proyecto.'
      );
    }
  );
});

test('sin DESIGN_ENGINE_URL mantiene fallback controlado', async () => {
  await withDesignEngineUrl(null, async () => {
    const response = await processDesignRequest({
      requestId: 'REQ-003',
      platform: 'ELANVISUAL',
      message: 'Necesito una propuesta de fachada'
    });

    assert.equal(response.handled, true);
    assert.equal(response.connected, false);
    assert.equal(response.processed, false);
    assert.equal(response.result.status, 'STUB_ACCEPTED');
  });
});
