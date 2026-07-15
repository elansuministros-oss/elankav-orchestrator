'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fetchCommercialOffer
} = require('../adapters/commercialLibraryAdapter');
const {
  buildCommercialLookupText,
  loadCommercialContext
} = require('../services/commercialContextService');
const {
  buildContextInstructions,
  resolveOfficialPlatformFacts
} = require('../services/openaiService');
const {
  CUSTOMER_INSTRUCTIONS
} = require('../services/messageService');

const VERIFIED_OFFER = Object.freeze({
  source: 'ELANKAV Commercial Library',
  productId: 'rotulo-cajuela',
  productName: 'Rótulo de cajuela',
  description: 'Rótulo de una cara',
  specifications: { minimumWidthCm: 120, minimumHeightCm: 120 },
  priceOffers: [
    {
      environment: 'interior',
      amount: 360,
      currency: 'USD',
      mode: 'starting-at',
      approximate: true
    },
    {
      environment: 'exterior',
      amount: 560,
      currency: 'USD',
      mode: 'starting-at',
      approximate: true
    }
  ],
  salesGuidance: {
    qualificationQuestion: '¿Lo necesitás para interior o para exterior?'
  },
  commercialRules: {
    priceIsApproximate: true,
    paymentAdvancePercent: 60,
    paymentBalancePercent: 40,
    maxQuestionsPerReply: 1
  }
});

test('SALES-01 adapter consulta la biblioteca por mensaje', async () => {
  let requestedUrl;

  const result = await fetchCommercialOffer(
    '¿Cuánto cuesta el rótulo de cajuela?',
    {
      fetchImpl: async url => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: VERIFIED_OFFER })
        };
      }
    }
  );

  assert.equal(result.productId, 'rotulo-cajuela');
  assert.match(
    requestedUrl.searchParams.get('message'),
    /cajuela/i
  );
});

test('SALES-01 adapter devuelve null para producto desconocido', async () => {
  const result = await fetchCommercialOffer('Quiero camisetas', {
    fetchImpl: async () => ({ status: 404, ok: false })
  });

  assert.equal(result, null);
});

test('SALES-01 contexto degrada sin romper WhatsApp', async () => {
  const context = await loadCommercialContext(
    { message: 'Quiero una fascia' },
    {
      fetchOffer: async () => {
        throw new Error('sin conexión');
      }
    }
  );

  assert.equal(context, null);
});

test('SALES-01 conserva el producto durante respuestas cortas', () => {
  const lookup = buildCommercialLookupText({
    message: 'Lo quiero para exterior',
    history: [
      { role: 'user', content: 'Me interesa el rótulo de cajuela' },
      { role: 'assistant', content: '¿Interior o exterior?' }
    ]
  });

  assert.match(lookup, /rótulo de cajuela/i);
  assert.match(lookup, /exterior/i);
  assert.doesNotMatch(lookup, /¿Interior o exterior\?/i);
});

test('SALES-01 entrega precios verificados a OpenAI', async () => {
  const commercial = await loadCommercialContext(
    { message: 'Quiero una cajuela' },
    { fetchOffer: async () => VERIFIED_OFFER }
  );
  const instructions = buildContextInstructions({ commercial });

  assert.match(instructions, /Rótulo de cajuela/);
  assert.match(instructions, /"amount":360/);
  assert.match(instructions, /"amount":560/);
  assert.match(instructions, /starting-at/);
  assert.match(instructions, /60% de anticipo/);
  assert.match(instructions, /como máximo la qualificationQuestion/);
  assert.match(instructions, /primera respuesta.*oferta verificada/i);
  assert.match(instructions, /No vuelvas a preguntar medida/i);
  assert.match(instructions, /No encadenes una entrevista/i);
});

test('SALES-01 política comercial conduce a cotización sin inventar', () => {
  assert.match(CUSTOMER_INSTRUCTIONS, /contexto comercial verificado/i);
  assert.match(CUSTOMER_INSTRUCTIONS, /modalidad exactos/i);
  assert.match(CUSTOMER_INSTRUCTIONS, /una sola pregunta útil/i);
  assert.match(CUSTOMER_INSTRUCTIONS, /nunca inventes precios/i);
  assert.match(CUSTOMER_INSTRUCTIONS, /nunca inventes, completes ni adivines dominios/i);
  assert.match(CUSTOMER_INSTRUCTIONS, /página principal como catálogo/i);
});

test('SALES-01 fija URL y ubicación oficiales de ELANVISUAL', () => {
  const facts = resolveOfficialPlatformFacts('elanvisual');
  const instructions = buildContextInstructions({ platform: 'elanvisual' });

  assert.deepEqual(facts, {
    id: 'elanvisual',
    name: 'ELANVISUAL',
    website: 'https://visual.elankav.com',
    businessLocation: 'Managua, Nicaragua'
  });
  assert.match(instructions, /https:\/\/visual\.elankav\.com/);
  assert.match(instructions, /Managua, Nicaragua/);
  assert.match(instructions, /nunca sustituyas, completes ni inventes otro dominio/i);
  assert.match(instructions, /página principal no equivale a un catálogo/i);
});
