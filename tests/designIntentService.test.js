'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDesignConversationPrompt,
  detectConversationDesignIntent,
  detectDesignIntent,
  resolveDesignRequestType,
  shouldRequestLogo,
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

test('detecta podrías mandarme usando el proyecto conversado', () => {
  const result = detectConversationDesignIntent({
    message: 'Podrías mandarme',
    history: [
      { role: 'user', content: 'Rótulo luminoso exterior de 1 m x 80 cm' },
      { role: 'assistant', content: 'Ya tengo las medidas del rótulo.' }
    ]
  });

  assert.equal(result.detected, true);
  assert.equal(result.reason, 'CONTEXTUAL_REQUEST');
});

test('un sí aislado no activa diseño', () => {
  const result = detectConversationDesignIntent({
    message: 'Sí',
    history: [
      { role: 'assistant', content: '¿Sería para interior o exterior?' }
    ]
  });

  assert.equal(result.detected, false);
});

test('un sí activa diseño después de ofrecer una propuesta visual', () => {
  const result = detectConversationDesignIntent({
    message: 'Sí',
    history: [
      { role: 'user', content: 'Quiero un rótulo para Gimnasio Reyna' },
      { role: 'assistant', content: '¿Querés que prepare una propuesta visual?' }
    ]
  });

  assert.equal(result.detected, true);
  assert.equal(result.reason, 'AFFIRMATIVE_VISUAL_REQUEST');
});

test('sin logo continúa el diseño cuando ya se pidió el archivo', () => {
  const result = detectConversationDesignIntent({
    message: 'Sin logo',
    history: [
      { role: 'assistant', content: 'Enviame el logo como imagen para preparar la propuesta.' }
    ]
  });

  assert.equal(result.detected, true);
  assert.equal(result.noLogoReply, true);
  assert.equal(shouldRequestLogo({ detection: result }), false);
});

test('una imagen continúa el diseño cuando ya se pidió el logo', () => {
  const result = detectConversationDesignIntent({
    message: 'Aquí está',
    references: [{ url: 'https://example.test/logo.png' }],
    history: [
      { role: 'assistant', content: 'Enviame el logo como imagen para preparar la propuesta.' }
    ]
  });

  assert.equal(result.detected, true);
  assert.equal(result.reason, 'LOGO_ASSET_CONTINUATION');
  assert.equal(shouldRequestLogo({ detection: result }), false);
});

test('pide logo una sola vez antes de generar', () => {
  const first = detectConversationDesignIntent({
    message: 'Diseñame una fachada para mi negocio'
  });
  const continued = detectConversationDesignIntent({
    message: 'Sí',
    history: [
      { role: 'assistant', content: 'Enviame el logo como imagen para preparar la propuesta.' }
    ]
  });

  assert.equal(shouldRequestLogo({ detection: first }), true);
  assert.equal(shouldRequestLogo({ detection: continued }), false);
});

test('el prompt conserva los datos confirmados de la conversación', () => {
  const prompt = buildDesignConversationPrompt({
    message: 'Sin logo',
    noLogoReply: true,
    history: [
      { role: 'user', content: 'Gimnasio Reyna, exterior, 1 m x 80 cm' },
      { role: 'user', content: 'Barra con discos centrada' }
    ]
  });

  assert.match(prompt, /Gimnasio Reyna/);
  assert.match(prompt, /1 m x 80 cm/);
  assert.match(prompt, /Barra con discos centrada/);
  assert.match(prompt, /no enviará un archivo de logo/);
});

test('clasifica el tipo para precargar el formulario', () => {
  assert.equal(resolveDesignRequestType({
    message: 'Podrías mandarme',
    history: [{ role: 'user', content: 'Quiero una fachada en ACM' }]
  }), 'fachada');

  assert.equal(resolveDesignRequestType({
    message: 'Necesito crear un logo para mi negocio'
  }), 'logo');

  assert.equal(resolveDesignRequestType({
    message: 'Quiero un rótulo luminoso'
  }), 'rotulo');
});
