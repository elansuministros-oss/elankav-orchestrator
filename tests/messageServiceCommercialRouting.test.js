'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  processMessage
} = require('../services/messageService');

function offerFixture() {
  return {
    status: 'active',
    source: 'ELANKAV Commercial Library',
    productId: 'boton-acrilico',
    productVersion: 'ECL-001A',
    effectiveSizeCm: 70,
    baseSizeUsed: false,
    dimensions: {
      baseCm: 60,
      maxStandardCm: 120
    },
    materialRules: {
      thicknessMm: 3,
      interiorDefault: true
    },
    pricingRule: {
      currency: 'USD',
      incrementAmount: 20
    },
    commercialRules: {
      paymentAdvancePercent: 60,
      paymentBalancePercent: 40
    },
    variants: [
      ['boton-transparente', 'Botón Transparente', 120],
      ['boton-con-impresion', 'Botón con Impresión', 150],
      ['boton-impresion-uv-premium', 'Botón Impresión UV Premium', 170],
      ['boton-premium-combinado', 'Botón Premium Combinado', 210]
    ].map(([id, name, total]) => ({
      id,
      name,
      quote: {
        status: 'priced',
        currency: 'USD',
        total
      }
    }))
  };
}

test('messageService responde precio oficial sin llamar OpenAI', async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.COMMERCIAL_LIBRARY_URL;
  let calls = 0;

  process.env.COMMERCIAL_LIBRARY_URL =
    'https://core.test/api/commercial-library';
  globalThis.fetch = async url => {
    calls += 1;
    assert.match(
      String(url),
      /productId=boton-acrilico&sizeCm=70/
    );

    return new Response(
      JSON.stringify({
        success: true,
        result: offerFixture()
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      }
    );
  };

  try {
    const result = await processMessage({
      message:
        '¿Cuánto cuesta el rótulo estilo botón con impresión de 70 cm para interior?',
      platform: 'ELANVISUAL',
      channel: 'whatsapp',
      externalUserId: '+50570000000',
      phone: '+50570000000',
      metadata: {
        conversationHistory: []
      }
    });

    assert.equal(result.provider, 'elankav');
    assert.equal(result.model, 'elankav-commercial-library');
    assert.equal(result.status, 'COMMERCIAL_RESPONSE_READY');
    assert.equal(result.commercial.productId, 'boton-acrilico');
    assert.equal(result.commercial.variantId, 'boton-con-impresion');
    assert.equal(result.commercial.sizeCm, 70);
    assert.match(result.reply, /USD 150/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;

    if (previousUrl === undefined) {
      delete process.env.COMMERCIAL_LIBRARY_URL;
    } else {
      process.env.COMMERCIAL_LIBRARY_URL = previousUrl;
    }
  }
});
