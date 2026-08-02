'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyVerifiedCommercialReply,
  buildRequestedMeasurementReply
} = require('../services/commercialReplyService');
const {
  PRODUCT_KNOWLEDGE
} = require('../services/commercialProductKnowledge');

const jalaVista = PRODUCT_KNOWLEDGE[0];

test('jala vista 60x60 does not ask interior or exterior', () => {
  const reply = buildRequestedMeasurementReply(jalaVista, {
    widthCm: 60,
    heightCm: 60
  });

  assert.match(reply, /USD 260/);
  assert.match(reply, /instalación exterior/i);
  assert.match(reply, /¿En qué ciudad se instalará\?/i);
  assert.doesNotMatch(reply, /interior o exterior/i);
});

test('short exterior answer keeps the active jala vista context', () => {
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
  assert.match(response.outputText, /¿En qué ciudad se instalará\?/i);
  assert.doesNotMatch(response.outputText, /qué producto querés cotizar/i);
});
