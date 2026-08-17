'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectOwnerUnifiedCommand } = require('../services/elanUnifiedOwnerCommandService');

test('parses seller natural language name and WhatsApp without contaminating displayName', () => {
  const command = detectOwnerUnifiedCommand('CREA UN NUEVO VENDEDOR EL NOMBRE ES : Juan Ruiz Y SU NUMERO DE WASAP : +505 7511 4256');
  assert.equal(command?.tool, 'crear_vendedor');
  assert.equal(command?.arguments?.data?.displayName, 'Juan Ruiz');
  assert.equal(command?.arguments?.data?.whatsapp, '+505 7511 4256');
});

test('parses conventional seller fields', () => {
  const command = detectOwnerUnifiedCommand('crea vendedor nombre: Ana Pérez, WhatsApp: +505 8888 7777');
  assert.equal(command?.tool, 'crear_vendedor');
  assert.equal(command?.arguments?.data?.displayName, 'Ana Pérez');
  assert.equal(command?.arguments?.data?.whatsapp, '+505 8888 7777');
});

test('parses se llama seller phrasing', () => {
  const command = detectOwnerUnifiedCommand('crea una vendedora se llama María López y su WhatsApp es +505 8777 6666');
  assert.equal(command?.tool, 'crear_vendedor');
  assert.equal(command?.arguments?.data?.displayName, 'María López');
  assert.equal(command?.arguments?.data?.whatsapp, '+505 8777 6666');
});