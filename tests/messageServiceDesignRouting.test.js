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
  let receivedRequest = null;

  process.env.DESIGN_ENGINE_URL = 'http://127.0.0.1:4300';
  global.fetch = async (_url, options = {}) => {
    receivedRequest = JSON.parse(options.body);
    return ({
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
  };

  return Promise.resolve()
    .then(() => callback(assetId, () => receivedRequest))
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
      },
      metadata: {
        references: [{
          url: 'https://elankav-core.vercel.app/api/whatsapp-media?token=test'
        }]
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
      },
      metadata: {
        references: [{
          url: 'https://elankav-core.vercel.app/api/whatsapp-media?token=test'
        }]
      }
    });

    assert.equal(result.design.conversational, false);
    assert.equal(result.design.clientReady, true);
  });
});

test('solicitud de propuesta pide el logo una sola vez', async () => {
  const result = await handleDesignIntent({
    message: 'Podrías mandarme',
    context: { platform: 'ELANVISUAL' },
    metadata: {
      conversationHistory: [
        { role: 'user', content: 'Rótulo luminoso exterior de 1 m x 80 cm' }
      ]
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.status, 'needs_information');
  assert.equal(result.model, 'elankav-design-intake');
  assert.match(result.outputText, /enviame el logo/i);
  assert.match(result.outputText, /sin logo/i);
});

test('sin logo genera la propuesta con los datos de la conversación', async () => {
  await withMockDesignEngine(async (_assetId, getReceivedRequest) => {
    const result = await handleDesignIntent({
      message: 'Sin logo',
      context: { platform: 'ELANVISUAL' },
      metadata: {
        conversationHistory: [
          {
            role: 'user',
            content: 'Gimnasio Reyna, rótulo exterior de 1 m x 80 cm'
          },
          {
            role: 'user',
            content: 'Logo sencillo de barra con discos centrado'
          },
          {
            role: 'assistant',
            content: 'Enviame el logo como imagen. Si no lo tenés, respondé sin logo.'
          }
        ]
      }
    });

    const request = getReceivedRequest();

    assert.equal(result.handled, true);
    assert.equal(result.status, 'processed');
    assert.match(request.message, /Gimnasio Reyna/);
    assert.match(request.message, /1 m x 80 cm/);
    assert.match(request.message, /barra con discos centrado/);
    assert.match(request.message, /no enviará un archivo de logo/);
  });
});

test('el logo enviado después de pedirlo genera la propuesta', async () => {
  await withMockDesignEngine(async () => {
    const result = await handleDesignIntent({
      message: 'Aquí está',
      context: { platform: 'ELANVISUAL' },
      metadata: {
        references: [{
          url: 'https://elankav-core.vercel.app/api/whatsapp-media?token=test'
        }],
        conversationHistory: [
          { role: 'user', content: 'Fachada exterior para Gimnasio Reyna' },
          { role: 'assistant', content: 'Enviame el logo como imagen para preparar la propuesta.' }
        ]
      }
    });

    assert.equal(result.handled, true);
    assert.equal(result.status, 'processed');
    assert.equal(result.design.assets.length, 1);
  });
});
