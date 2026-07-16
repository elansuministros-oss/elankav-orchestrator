'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyVerifiedCommercialReply,
  buildVerifiedCommercialReply,
  hasCommercialPriceIntent,
  resolveAdvertisedOffer
} = require('../services/commercialReplyService');
const {
  PRODUCT_KNOWLEDGE,
  calculateDimensionPrice,
  extractDimensions
} = require('../services/commercialProductKnowledge');

const BUTTON_OFFER = Object.freeze({
  available: true,
  productId: 'boton-acrilico',
  productName: 'Rótulo estilo botón en acrílico',
  specifications: {
    baseCm: 60
  },
  priceOffers: [
    {
      label: 'Botón Transparente 60 cm',
      amount: 100,
      currency: 'USD',
      mode: 'reference',
      approximate: false
    },
    {
      label: 'Botón con Impresión 60 cm',
      amount: 130,
      currency: 'USD',
      mode: 'reference',
      approximate: false
    },
    {
      label: 'Botón Impresión UV Premium 60 cm',
      amount: 150,
      currency: 'USD',
      mode: 'reference',
      approximate: false
    }
  ],
  salesGuidance: {
    qualificationQuestion: '¿Qué acabado te interesa para tu rótulo botón?'
  }
});

const AD_HISTORY = Object.freeze([
  {
    role: 'assistant',
    content: [
      'Gracias por escribir a ELAN VISUAL.',
      'Vimos que te interesó nuestro rótulo acrílico estilo botón del anuncio.',
      'Este modelo tiene un valor de USD 260.'
    ].join('\n')
  }
]);

test('SALES-UX-01 detecta una solicitud de cotización', () => {
  assert.equal(
    hasCommercialPriceIntent(
      'Hola, quiero cotizar un rótulo en acrílico estilo botón'
    ),
    true
  );
  assert.equal(hasCommercialPriceIntent('Lo quiero redondo'), false);
});

test('SALES-UX-01 responde el precio autorizado sin interrogatorio', () => {
  const reply = buildVerifiedCommercialReply({
    message: 'Quiero cotizar un rótulo en acrílico estilo botón',
    commercial: BUTTON_OFFER
  });

  assert.match(reply, /Botón Transparente 60 cm: USD 100/);
  assert.match(reply, /Botón con Impresión 60 cm: USD 130/);
  assert.match(reply, /¿Qué acabado te interesa/);
  assert.equal((reply.match(/\?/g) || []).length, 1);
  assert.doesNotMatch(reply, /cotizador/i);
});

test('SALES-UX-01 explica una medida distinta sin inventar precio', () => {
  const reply = buildVerifiedCommercialReply({
    message: 'Quiero cotizarlo de 50 cm',
    commercial: BUTTON_OFFER
  });

  assert.match(reply, /medida estándar publicada es de 60 cm/i);
  assert.match(reply, /medida de 50 cm debe confirmarse/i);
  assert.doesNotMatch(reply, /USD 8[0-9]/);
});

test('SALES-UX-01 sustituye una respuesta evasiva por la oferta verificada', () => {
  const guarded = applyVerifiedCommercialReply({
    message: '¿Cuánto cuesta el rótulo estilo botón?',
    commercial: BUTTON_OFFER,
    response: {
      outputText: 'El precio debe revisarse en el cotizador.',
      model: 'gpt-test'
    }
  });

  assert.equal(guarded.model, 'elankav-commercial-verified');
  assert.equal(guarded.commercialAction, true);
  assert.match(guarded.outputText, /USD 100/);
  assert.match(guarded.outputText, /USD 130/);
  assert.doesNotMatch(guarded.outputText, /cotizador/i);
});

test('SALES-UX-01 no repite una pregunta ya respondida', () => {
  const cajuela = {
    available: true,
    productName: 'Rótulo de cajuela',
    specifications: { minimumWidthCm: 120 },
    priceOffers: [{
      label: 'Interior desde 1.20 × 1.20 m',
      environment: 'interior',
      amount: 360,
      currency: 'USD',
      mode: 'starting-at',
      approximate: true
    }],
    salesGuidance: {
      qualificationQuestion: '¿Lo necesitás para interior o para exterior?'
    }
  };
  const reply = buildVerifiedCommercialReply({
    message: '¿Cuánto cuesta?',
    history: [{ role: 'user', content: 'Lo necesito para interior' }],
    commercial: cajuela
  });

  assert.match(reply, /desde USD 360/);
  assert.doesNotMatch(reply, /¿Lo necesitás para interior o para exterior\?/);
});

test('SALES-AD-CONTEXT-01 reconoce el precio publicado en el anuncio', () => {
  const offer = resolveAdvertisedOffer({
    message: 'Vi el rótulo acrílico de USD 260 y quiero cotizar uno',
    history: AD_HISTORY
  });

  assert.equal(offer.amount, 260);
  assert.equal(offer.currency, 'USD');
});

test('SALES-AD-CONTEXT-01 prioriza el precio anunciado aunque la biblioteca no resuelva producto', () => {
  const guarded = applyVerifiedCommercialReply({
    message: 'Hola, vi el rótulo acrílico de USD 260 y quiero cotizar uno para mi negocio.',
    history: AD_HISTORY,
    commercial: { available: false },
    response: {
      outputText: 'El valor debe revisarse en el cotizador según las medidas.',
      model: 'gpt-test'
    }
  });

  assert.equal(guarded.model, 'elankav-commercial-ad-verified');
  assert.equal(guarded.commercialSource, 'advertisement');
  assert.match(guarded.outputText, /mantiene el precio publicado de USD 260/i);
  assert.match(guarded.outputText, /igual al anuncio/i);
  assert.equal((guarded.outputText.match(/\?/g) || []).length, 1);
  assert.doesNotMatch(guarded.outputText, /debe revisarse en el cotizador/i);
});

test('SALES-AD-CONTEXT-01 no acepta un precio inventado por el cliente', () => {
  const guarded = applyVerifiedCommercialReply({
    message: 'Vi uno de USD 999 y quiero cotizarlo',
    history: AD_HISTORY,
    commercial: { available: false },
    response: {
      outputText: 'Necesito confirmar el producto.',
      model: 'gpt-test'
    }
  });

  assert.equal(guarded.model, 'gpt-test');
  assert.equal(guarded.outputText, 'Necesito confirmar el producto.');
});

test('SALES-MEASURE-01 registra la regla oficial del jala vista', () => {
  const [product] = PRODUCT_KNOWLEDGE;

  assert.equal(product.productId, 'jalavista-acrilico-doble-cara');
  assert.deepEqual(product.standardDimensions, { widthCm: 60, heightCm: 60 });
  assert.equal(product.advertisedPriceUsd, 260);
  assert.equal(product.pricingRule.stepCm, 10);
  assert.equal(product.pricingRule.incrementUsd, 15);
});

test('SALES-MEASURE-01 responde directamente la medida preguntada por el cliente', () => {
  const guarded = applyVerifiedCommercialReply({
    message: 'Buenas, ¿qué medida tiene?',
    history: AD_HISTORY,
    commercial: { available: false },
    response: {
      outputText: '¿Qué medida aproximada necesitás?',
      model: 'gpt-test'
    }
  });

  assert.equal(guarded.model, 'elankav-commercial-knowledge');
  assert.equal(guarded.commercialSource, 'product-knowledge');
  assert.match(guarded.outputText, /60 × 60 cm/i);
  assert.match(guarded.outputText, /USD 260/i);
  assert.doesNotMatch(guarded.outputText, /bloque|incremento|regla|precio base/i);
  assert.doesNotMatch(guarded.outputText, /qué medida aproximada necesitás/i);
});

test('SALES-MEASURE-01 calcula 80 × 40 cm sin descontar la dimensión menor', () => {
  const product = PRODUCT_KNOWLEDGE[0];
  const dimensions = extractDimensions('Unos 80 x 40 cm');
  const pricing = calculateDimensionPrice(product, dimensions);

  assert.deepEqual(dimensions, { widthCm: 80, heightCm: 40 });
  assert.equal(pricing.widthSteps, 2);
  assert.equal(pricing.heightSteps, 0);
  assert.equal(pricing.amount, 290);
});

test('SALES-MEASURE-01 responde el cálculo de la medida solicitada', () => {
  const guarded = applyVerifiedCommercialReply({
    message: 'Unos 80x40',
    history: AD_HISTORY,
    commercial: { available: false },
    response: {
      outputText: 'El precio exacto debe revisarse en el cotizador.',
      model: 'gpt-test'
    }
  });

  assert.equal(guarded.model, 'elankav-commercial-knowledge');
  assert.match(guarded.outputText, /80 × 40 cm/i);
  assert.match(guarded.outputText, /USD 290/i);
  assert.doesNotMatch(
    guarded.outputText,
    /incremento|bloque|precio base|no disminuyen|10 cm|15/i
  );
  assert.doesNotMatch(guarded.outputText, /debe revisarse en el cotizador/i);
});

test('SALES-MEASURE-01 suma incrementos cuando ambas dimensiones superan 60 cm', () => {
  const product = PRODUCT_KNOWLEDGE[0];
  const pricing = calculateDimensionPrice(product, {
    widthCm: 80,
    heightCm: 70
  });

  assert.equal(pricing.widthSteps, 2);
  assert.equal(pricing.heightSteps, 1);
  assert.equal(pricing.totalSteps, 3);
  assert.equal(pricing.amount, 305);
});
