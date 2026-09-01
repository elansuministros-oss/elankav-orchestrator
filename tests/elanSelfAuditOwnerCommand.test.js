'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  OWNER_COMMANDS,
  detectElanSelfAuditCommand,
  detectOwnerCommand
} = require('../services/ownerCommandService');

test('ELAN audítate routes to self-audit before legacy permission catalog', () => {
  const command = detectOwnerCommand('ELAN audítate');
  assert.equal(command.type, OWNER_COMMANDS.SELF_AUDIT);
});

test('natural variants route to self-audit', () => {
  for (const message of [
    'audita tus capacidades',
    'audita tus accesos',
    'qué te falta',
    'qué podés hacer realmente',
    'revisa tus capacidades'
  ]) {
    const command = detectOwnerCommand(message);
    assert.equal(command.type, OWNER_COMMANDS.SELF_AUDIT, message);
  }
});

test('plain permission question remains the existing permission command', () => {
  const command = detectOwnerCommand('qué permisos tienes');
  assert.equal(command.type, OWNER_COMMANDS.MODE_PERMISSIONS);
});

test('self-audit detector does not capture unrelated production audit', () => {
  assert.equal(detectElanSelfAuditCommand('audita produccion'), null);
  const command = detectOwnerCommand('audita produccion');
  assert.equal(command.type, OWNER_COMMANDS.OWNER_OPS_READ);
  assert.equal(command.capability, 'production.audit');
});
