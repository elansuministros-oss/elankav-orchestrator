'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectDesignIntent,
  normalizeDesignIntentText
} = require('../services/designIntentService');

test('normaliza acentos para detectar diseño', () => {
  assert.equal(
    normalizeDesignIntentText('  DISEÑAME un RÓTULO  '),
    'disename un rotulo'
  );
});

test('detecta solicitud directa de diseño', () => {
  const result = detectDesignIntent(
    'Diseñame una fachada para mi negocio'
  );

  assert.equal(result.detected, true);
  assert.equal(result.intent, 'design');
  assert.equal(result.confidence, 'RULE');
});

test('detecta solicitud de render', () => {
  const result = detectDesignIntent(
    'Quiero un render de cómo quedaría el rótulo'
  );

  assert.equal(result.detected, true);
});

test('detecta propuesta visual', () => {
  const result = detectDesignIntent(
    'Necesito una propuesta visual para la fachada'
  );

  assert.equal(result.detected, true);
});

test('detecta solicitud de una propuesta similar a una referencia', () => {
  const result = detectDesignIntent(
    'Me gustaría algo así o si pueden darme algo más elegante mejor'
  );

  assert.equal(result.detected, true);
  assert.equal(result.intent, 'design');
});

test('no activa diseño por pregunta educativa', () => {
  const result = detectDesignIntent(
    'Qué es diseño gráfico'
  );

  assert.equal(result.detected, false);
  assert.equal(result.confidence, 'EXCLUDED');
});

test('no activa diseño por error técnico del sistema', () => {
  const result = detectDesignIntent(
    'Tengo un problema con el diseño de la página del sistema'
  );

  assert.equal(result.detected, false);
});

test('no activa diseño con mensaje vacío', () => {
  const result = detectDesignIntent('');

  assert.equal(result.detected, false);
  assert.equal(result.confidence, 'NONE');
});
