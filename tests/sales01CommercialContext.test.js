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
  buildRuntimeInstructions
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

test('SALES-01 contexto degrada sin romper WhatsApp cuando fallan ambas fuentes', async () => {
  const context = await loadCommercialContext(
    { message: 'Quiero una fascia' },
    {
      fetchOffer: async () => {
        throw new Error('sin conexión');
      },
      loadKnowledge: async () => {
        throw new Error('connect no disponible');
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

test('SALES-01 entrega datos comerciales verificados sin imponer conversación paralela', async () => {
  const commercial = await loadCommercialContext(
    { message: 'Quiero una cajuela' },
    {
      fetchOffer: async () => VERIFIED_OFFER,
      loadKnowledge: async () => null
    }
  );
  const instructions = buildContextInstructions({
    commercial,
    aiRuntime: {
      authority: 'CONNECT_AI_PLATFORMS',
      authorityLocked: true,
      platform: {
        responseRules: {}
      }
    }
  });

  assert.match(instructions, /Rótulo de cajuela/);
  assert.match(instructions, /"amount":360/);
  assert.match(instructions, /"amount":560/);
  assert.match(instructions, /starting-at/);
  assert.match(instructions, /Integridad comercial/);
  assert.match(instructions, /gobierna exclusivamente la configuración publicada de CONNECT/i);
  assert.doesNotMatch(instructions, /como máximo la qualificationQuestion/i);
  assert.doesNotMatch(instructions, /primera respuesta.*oferta verificada/i);
  assert.doesNotMatch(instructions, /No vuelvas a preguntar medida/i);
});

test('SALES-01 política comercial se obtiene del runtime publicado de CONNECT', () => {
  const instructions = buildRuntimeInstructions({
    platform: {
      initialMessage: 'Hola, soy ELAN IA de ELANVISUAL.',
      instructions: [
        'Usá contexto comercial verificado.',
        'Mantené la modalidad exacta del precio.',
        'Hacé una sola pregunta útil.',
        'Nunca inventés precios.',
        'Nunca inventés, completés ni adivinés dominios.',
        'No presentes la página principal como catálogo.'
      ].join(' '),
      responseRules: {
        noInventedData: true,
        exactCatalogPrices: true,
        oneQuestionAtATime: true
      }
    }
  });

  assert.match(instructions, /contexto comercial verificado/i);
  assert.match(instructions, /modalidad exacta/i);
  assert.match(instructions, /una sola pregunta útil/i);
  assert.match(instructions, /Nunca inventés precios/i);
  assert.match(instructions, /Nunca inventés, completés ni adivinés dominios/i);
  assert.match(instructions, /página principal como catálogo/i);
});

test('SALES-01 con runtime CONNECT la URL sale de CONNECT y no del fallback local', () => {
  const facts = resolveOfficialPlatformFacts('elanvisual');
  const instructions = buildContextInstructions({
    platform: 'elanvisual',
    aiRuntime: {
      authority: 'CONNECT_AI_PLATFORMS',
      authorityLocked: true,
      platform: {
        responseRules: {
          websiteInvitation: {
            enabled: true,
            url: 'https://visual.elankav.com/controlado-por-connect'
          }
        }
      }
    }
  });

  assert.deepEqual(facts, {
    id: 'elanvisual',
    name: 'ELANVISUAL',
    website: 'https://visual.elankav.com',
    businessLocation: 'Managua, Nicaragua'
  });
  assert.match(instructions, /https:\/\/visual\.elankav\.com\/controlado-por-connect/);
  assert.match(instructions, /Managua, Nicaragua/);
  assert.doesNotMatch(instructions, /usá exclusivamente el sitio https:\/\/visual\.elankav\.com;/i);
});
