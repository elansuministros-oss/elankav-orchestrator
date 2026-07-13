'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleDesignIntent
} = require('../services/messageService');

function withMockDesignEngine(callback) {
  const previousUrl = process.env.DESIGN_ENGINE_URL;
  const previousFetch = global.fetch;
  const assetId = '77777777-7777-4777-8777-777777777777';

  process.env.DESIGN_ENGINE_URL = 'http://127.0.0.1:4300';
  global.fetch = async () => ({
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
  });

  return Promise.resolve()
    .then(() => callback(assetId))
    .finally(() => {
      global.fetch = previousFetch;
      if (previousUrl === undefined) {
        delete process.env.DESIGN_ENGINE_URL;
      } else {
        process.env.DESIGN_ENGINE_URL = previousUrl;
      }
    });
}

test('messageService devuelve asset real del Design Engine', async () => {
  await withMockDesignEngine(async assetId => {
    const result = await handleDesignIntent({
      message: 'Generá una propuesta visual para un rótulo exterior',
      context: {
        requestId: 'MSG-DESIGN-001',
        platform: 'ELANVISUAL',
        channel: 'whatsapp',
        externalUserId: '+50578828089',
        phone: '+50578828089'
      }
    });

    assert.equal(result.handled, true);
    assert.equal(result.designAction, true);
    assert.equal(result.model, 'elankav-design-engine-http');
    assert.equal(result.status, 'processed');
    assert.equal(result.outputText, 'Preparé una propuesta visual para tu proyecto.');
    assert.equal(result.design.status, 'PROCESSED');
    assert.equal(result.design.clientReady, true);
    assert.equal(result.design.assets.length, 1);
    assert.equal(result.design.assets[0].id, assetId);
  });
});

test('messageService no desvía mensajes sin intención de diseño', async () => {
  const result = await handleDesignIntent({
    message: 'Necesito información sobre mis pedidos',
    context: { platform: 'ELANVISUAL' }
  });

  assert.equal(result.handled, false);
  assert.equal(result.detection.detected, false);
});

test('solicitud de diseño sin plataforma continúa al fallback', async () => {
  const result = await handleDesignIntent({
    message: 'Quiero un render de mi negocio',
    context: {}
  });

  assert.equal(result.handled, false);
  assert.equal(result.detection.detected, true);
  assert.equal(result.reason, 'DESIGN_PLATFORM_REQUIRED');
});

test('resultado de diseño nunca conversa directamente con cliente', async () => {
  await withMockDesignEngine(async () => {
    const result = await handleDesignIntent({
      message: 'Necesito una propuesta visual para la fachada',
      context: {
        platform: 'ELANVISUAL',
        externalUserId: '+50578828089'
      }
    });

    assert.equal(result.design.conversational, false);
    assert.equal(result.design.clientReady, true);
  });
});
