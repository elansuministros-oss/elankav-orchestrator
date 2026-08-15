'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OWNER_COMMANDS,
  detectOwnerCommand
} = require('../services/ownerCommandService');

test('routes server audit to readonly owner ops', () => {
  const command = detectOwnerCommand('ELAN audita el servidor de producción');
  assert.equal(command.type, OWNER_COMMANDS.OWNER_OPS_READ);
  assert.equal(command.capability, 'server.summary');
});

test('routes CONNECT logs to readonly owner ops', () => {
  const command = detectOwnerCommand('ELAN revisa los errores de CONNECT');
  assert.equal(command.type, OWNER_COMMANDS.OWNER_OPS_READ);
  assert.equal(command.capability, 'service.logs');
  assert.equal(command.target, 'connect');
});

test('routes Orchestrator repository status to readonly owner ops', () => {
  const command = detectOwnerCommand('ELAN revisa el git del Orchestrator');
  assert.equal(command.type, OWNER_COMMANDS.OWNER_OPS_READ);
  assert.equal(command.capability, 'git.status');
  assert.equal(command.target, 'orchestrator');
});

test('does not create arbitrary owner shell capability', () => {
  const command = detectOwnerCommand('ELAN ejecuta rm -rf /');
  assert.equal(command, null);
});
