'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CUSTOMER_INSTRUCTIONS,
  OWNER_INSTRUCTIONS,
  resolveMessageInstructions
} = require('../services/messageService');

test('CLIENT-001A clientes reciben política comercial y no técnica', () => {
  const instructions = resolveMessageInstructions({
    ownerMode: false,
    customInstructions: ''
  });

  assert.equal(instructions, CUSTOMER_INSTRUCTIONS);
  assert.match(instructions, /asistente comercial/i);
  assert.match(instructions, /máximo una pregunta/i);
  assert.match(instructions, /nunca inventes precios/i);
  assert.doesNotMatch(instructions, /asistente técnico del ELANKAV Orchestrator/i);
});

test('CLIENT-001A mantiene instrucciones Owner separadas', () => {
  const instructions = resolveMessageInstructions({
    ownerMode: true,
    customInstructions: ''
  });

  assert.equal(instructions, OWNER_INSTRUCTIONS);
  assert.match(instructions, /Erick Cano/i);
  assert.doesNotMatch(instructions, /asistente comercial de atención al cliente/i);
});

test('CLIENT-001A respeta instrucciones explícitas del canal', () => {
  const instructions = resolveMessageInstructions({
    ownerMode: false,
    customInstructions: 'Instrucción autorizada de campaña'
  });

  assert.equal(instructions, 'Instrucción autorizada de campaña');
});

test('CLIENT-001A política evita formularios y preguntas repetidas', () => {
  assert.match(CUSTOMER_INSTRUCTIONS, /no conviertas una explicación en un formulario/i);
  assert.match(CUSTOMER_INSTRUCTIONS, /No repitas datos/i);
  assert.match(CUSTOMER_INSTRUCTIONS, /producto, medida y si es interior o exterior/i);
  assert.match(CUSTOMER_INSTRUCTIONS, /No hables de Orchestrator/i);
});
