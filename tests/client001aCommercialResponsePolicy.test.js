'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OWNER_INSTRUCTIONS,
  buildRuntimeInstructions,
  resolveMessageInstructions
} = require('../services/messageService');

function runtime() {
  return {
    platform: {
      initialMessage: 'Hola, soy ELAN IA de ELANVISUAL.',
      instructions: [
        'Tu objetivo principal es vender.',
        'Respondé primero la solicitud concreta.',
        'Hacé como máximo una pregunta.',
        'No inventés precios.',
        'No repitas datos que el cliente ya proporcionó.'
      ].join(' '),
      responseRules: {
        noInventedData: true,
        exactCatalogPrices: true,
        oneQuestionAtATime: true
      },
      continuity: { enabled: true },
      catalogAccess: { enabled: true, onlyPublished: true }
    }
  };
}

test('CLIENT-001A clientes reciben la política publicada por CONNECT', () => {
  const instructions = resolveMessageInstructions({
    ownerMode: false,
    customInstructions: '',
    runtime: runtime()
  });

  assert.match(instructions, /IDENTIDAD PUBLICADA/i);
  assert.match(instructions, /Tu objetivo principal es vender/i);
  assert.match(instructions, /máximo una pregunta/i);
  assert.match(instructions, /No inventés precios/i);
  assert.doesNotMatch(instructions, /asistente técnico del ELANKAV Orchestrator/i);
});

test('CLIENT-001A mantiene instrucciones Owner separadas', () => {
  const instructions = resolveMessageInstructions({
    ownerMode: true,
    customInstructions: ''
  });

  assert.equal(instructions, OWNER_INSTRUCTIONS);
  assert.match(instructions, /Erick Cano/i);
});

test('CLIENT-001A ignora instrucciones comerciales inyectadas fuera de CONNECT', () => {
  const instructions = resolveMessageInstructions({
    ownerMode: false,
    customInstructions: 'Instrucción alternativa del canal',
    runtime: runtime()
  });

  assert.doesNotMatch(instructions, /Instrucción alternativa del canal/);
  assert.match(instructions, /AUTORIDAD DE COMPORTAMIENTO: CONNECT/i);
});

test('CLIENT-001A no mantiene una política comercial paralela hardcodeada', () => {
  const instructions = buildRuntimeInstructions(runtime());
  assert.match(instructions, /REGLAS PUBLICADAS/);
  assert.doesNotMatch(instructions, /asistente comercial de atención al cliente del ecosistema ELANKAV/i);
});
