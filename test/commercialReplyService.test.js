'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyVerifiedCommercialReply,
  buildRequestedMeasurementReply,
  buildVerifiedCommercialReply
} = require('../services/commercialReplyService');
const {
  PRODUCT_KNOWLEDGE
} = require('../services/commercialProductKnowledge');

const jalaVista = PRODUCT_KNOWLEDGE[0];

test('jala vista 60x60 sells directly without asking interior or exterior', () => {
  const reply = buildRequestedMeasurementReply(jalaVista, {
    widthCm: 60,
    heightCm: 60
  });

  assert.match(reply, /USD 260/);
  assert.match(reply, /instalación exterior/i);
  assert.match(reply, /mandámelo por aquí/i);
  assert.match(reply, /nosotros podemos prepararlo/i);
  assert.match(reply, /https:\/\/visual\.elankav\.com\//i);
  assert.match(reply, /¿En qué ciudad se instalará\?/i);
  assert.doesNotMatch(reply, /interior o exterior/i);
});

test('short exterior answer keeps the active jala vista context and sales CTA', () => {
  const response = applyVerifiedCommercialReply({
    message: 'Exterior',
    history: [
      {
        role: 'user',
        content: '¿Cuánto cuesta un rótulo jala vista de 60x60?'
      },
      {
        role: 'assistant',
        content: 'El rótulo jala vista de 60 × 60 cm tiene un valor de USD 260.'
      }
    ],
    commercial: null,
    response: {
      outputText: '¿Qué producto querés cotizar?'
    }
  });

  assert.equal(response.model, 'elankav-commercial-continuation');
  assert.match(response.outputText, /jala vista/i);
  assert.match(response.outputText, /diseñado para exterior/i);
  assert.match(response.outputText, /mandámelo por aquí/i);
  assert.match(response.outputText, /nosotros podemos prepararlo/i);
  assert.match(response.outputText, /https:\/\/visual\.elankav\.com\//i);
  assert.match(response.outputText, /¿En qué ciudad se instalará\?/i);
  assert.doesNotMatch(response.outputText, /qué producto querés cotizar/i);
});

test('every verified catalog product receives the global sales CTA', () => {
  const reply = buildVerifiedCommercialReply({
    message: '¿Cuánto cuesta?',
    history: [],
    commercial: {
      available: true,
      productId: 'banner-lona-impresa',
      productName: 'Banner en lona impresa',
      specifications: {},
      priceOffers: [
        {
          label: 'Precio por metro cuadrado',
          amount: 18,
          currency: 'USD'
        }
      ],
      salesGuidance: {
        qualificationQuestion: '¿Qué medida necesitás?'
      }
    }
  });

  assert.match(reply, /Banner en lona impresa/i);
  assert.match(reply, /USD 18/i);
  assert.match(reply, /mandámelo por aquí/i);
  assert.match(reply, /nosotros podemos prepararlo/i);
  assert.match(reply, /https:\/\/visual\.elankav\.com\//i);
  assert.match(reply, /¿Qué medida necesitás\?/i);
});

test('catalog product may override the global CTA through sales guidance', () => {
  const reply = buildVerifiedCommercialReply({
    message: 'Precio',
    history: [],
    commercial: {
      available: true,
      productId: 'servicio-tecnico',
      productName: 'Servicio técnico',
      specifications: {},
      priceOffers: [
        {
          label: 'Diagnóstico',
          amount: 25,
          currency: 'USD'
        }
      ],
      salesGuidance: {
        designCta: 'Mandanos una foto del equipo para revisar el caso.',
        websiteCta: 'Conocé nuestros servicios en https://visual.elankav.com/',
        qualificationQuestion: '¿En qué ciudad estás?'
      }
    }
  });

  assert.match(reply, /Mandanos una foto del equipo/i);
  assert.match(reply, /Conocé nuestros servicios/i);
  assert.match(reply, /¿En qué ciudad estás\?/i);
  assert.doesNotMatch(reply, /Si ya tenés el diseño o logotipo/i);
});
