'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectOwnerCommand } = require('../services/ownerCommandService');

test('PROTECTED Owner: "Audita todas tus funciones" routes to self audit', () => {
  const command = detectOwnerCommand('Audita todas tus funciones');
  assert.equal(command?.type, 'self_audit');
});

test('PROTECTED Owner: "Modo operador" routes to Owner general mode', () => {
  const command = detectOwnerCommand('Modo operador');
  assert.equal(command?.type, 'mode_set');
  assert.equal(command?.mode, 'OWNER_GENERAL');
});
