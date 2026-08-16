'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectSupervisorCommand,
  STATUS_TYPE
} = require('../services/ownerOpsSupervisorCommandPatch');

test('routes Orchestrator self restart through confirmed supervisor operation', () => {
  const command = detectSupervisorCommand('ELAN reinicia Orchestrator');
  assert.equal(command.capability, 'service.restart');
  assert.equal(command.target, 'orchestrator');
  assert.match(command.impact, /supervisor externo/i);
});

test('routes exact commit deploy only when target and full sha are present', () => {
  const sha = '1234567890abcdef1234567890abcdef12345678';
  const command = detectSupervisorCommand(`ELAN despliega Orchestrator commit ${sha}`);
  assert.equal(command.capability, 'repository.deploy');
  assert.equal(command.target, 'orchestrator');
  assert.equal(command.parameters.expectedCommit, sha);
  assert.equal(command.parameters.restart, true);
});

test('does not accept deploy without exact 40 character commit', () => {
  assert.equal(detectSupervisorCommand('ELAN despliega Orchestrator commit abc1234'), null);
});

test('routes supervisor operation status query', () => {
  const command = detectSupervisorCommand('ELAN estado OPS-1234567890-ABC123');
  assert.equal(command.type, STATUS_TYPE);
  assert.equal(command.operationId, 'OPS-1234567890-ABC123');
});
