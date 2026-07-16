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
  productName: 'Rótulo botón acrílico',
  prices: Object.freeze({ interior: 130, exterior: 160 }),
  currency: 'USD'
});

const AD_HISTORY = Object.freeze([
  Object.freeze({
    role: 'assistant',
    content: [
      'Gracias por escribir a ELAN VISUAL.',
      'Vimos que te interesó nuestro rótulo acrílico estilo botón del anuncio.',
      'Este modelo tiene un valor de USD 260.'
    ].join('\n')
  }),
  Object.freeze({
    role: 'user',
    content: 'Hola, vi el rótulo acrílico de USD 260 y quiero cotizar uno para mi negocio.'
  })
]);

test('detecta intención comercial de precio', () => {
  assert.equal(hasCommercialPriceIntent('¿Cuánto cuesta?'), true);
  assert.equal(hasCommercialPriceIntent('¿Qué colores manejan?'), false);
});

test('resuelve precio anunciado desde el historial', () => {
  const offer = resolveAdvertisedOffer({
    message: '¿Qué medida tiene?',
    history: AD_HISTORY,
    commercial: { available: false }
  });

  assert.equal(offer.amount, 260);
  assert.equal(offer.currency, 'USD');
});

test('conserva oferta verificada de biblioteca comercial', () => {
  const reply = buildVerifiedCommercialReply({
    message: '¿Cuánto cuesta?',
    history: [],
    commercial: BUTTON_OFFER
  });

  assert.match(reply, /USD 130/i);
  assert.match(reply, /USD 160/i);
});

test('no inventa un precio solo porque el cliente lo escribió', () => {
  const offer = resolveAdvertisedOffer({
    message: 'Quiero uno de USD 9999',
    history: [],
    commercial: { available: false }
  });

  assert.equal(offer, null);
});

test('mantiene la respuesta original cuando no hay conocimiento verificado', () => {
  const guarded = applyVerifiedCommercialReply({
    message: 'Quiero un producto desconocido',
    history: [],
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

  assert.equal(product.productId, 'JALAVISTA_DOBLE');
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

  assert.match(guarded.outputText, /60 × 60 cm/i);
  assert.match(guarded.outputText, /USD 260/i);
  assert.doesNotMatch(guarded.outputText, /bloque|incremento|regla|precio base/i);
  assert.doesNotMatch(guarded.outputText, /qué medida aproximada necesitás/i);
});

test('SALES-MEASURE-01 calcula 80 × 40 cm sin revelar la fórmula interna', () => {
  const guarded = applyVerifiedCommercialReply({
    message: 'Unos 80x40',
    history: AD_HISTORY,
    commercial: { available: false },
    response: {
      outputText: 'Debe revisarse en el cotizador.',
      model: 'gpt-test'
    }
  });

  assert.match(guarded.outputText, /80 × 40 cm/i);
  assert.match(guarded.outputText, /USD 290/i);
  assert.doesNotMatch(
    guarded.outputText,
    /incremento|bloque|precio base|no disminuyen|10 cm|15/i
  );
  assert.doesNotMatch(guarded.outputText, /debe revisarse en el cotizador/i);
});

test('SALES-MEASURE-01 calcula incrementos en ambas dimensiones', () => {
  const [product] = PRODUCT_KNOWLEDGE;
  const pricing = calculateDimensionPrice(product, { widthCm: 80, heightCm: 70 });

  assert.equal(pricing.amount, 305);
  assert.equal(pricing.totalSteps, 3);
});

test('SALES-MEASURE-01 extrae medidas escritas por el cliente', () => {
  assert.deepEqual(extractDimensions('Lo quiero de 80 x 40 cm'), {
    widthCm: 80,
    heightCm: 40
  });
});
