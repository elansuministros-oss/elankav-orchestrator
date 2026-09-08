'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { detectOwnerCommand } = require('../services/ownerCommandService');

const cases = [
  ['ELAN actívate', 'autonomy', true],
  ['ELAN desactívate', 'autonomy', false],
  ['Pausa', 'autonomy', false],
  ['Activa ventas', 'sales', true],
  ['Desactiva ventas', 'sales', false],
  ['Activa proveedores', 'providers', true],
  ['Desactiva proveedores', 'providers', false],
  ['Activa modo copiloto', 'copilot', true]
];

test('Owner natural language resolves universal operational controls', () => {
  for (const [message, scope, enabled] of cases) {
    assert.deepEqual(detectOwnerCommand(message), {
      type: 'operational_control',
      scope,
      enabled
    }, message);
  }
});
