'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyVerifiedCommercialReply,
  buildVerifiedCommercialReply,
  hasCommercialPriceIntent
} = require('../services/commercialReplyService');

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
