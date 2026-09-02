'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  detectSupervisorCommand,
  detectTarget,
  explicitTarget
} = require('../services/ownerOpsSupervisorCommandPatch');

const SHA = 'ca314d1671f3b7b67ffe1f3a13e0ad4befb42d28';

test('explicit ELANVISUAL repository wins even when CONNECT is mentioned negatively', () => {
  const message = [
    'ELAN, despliega ELANVISUAL producción.',
    'Repositorio exacto: elansuministros-oss/elanvisual-platform',
    'Rama exacta: elanvisual-desde-elanpet',
    `Commit exacto: ${SHA}`,
    'No tocar CONNECT.',
    'No tocar ORCHESTRATOR.'
  ].join('\n');

  assert.equal(explicitTarget(message), 'elanvisual');
  assert.equal(detectTarget(message), 'elanvisual');

  const command = detectSupervisorCommand(message);
  assert.equal(command.target, 'elanvisual');
  assert.equal(command.capability, 'repository.deploy');
  assert.equal(command.parameters.expectedCommit, SHA);
  assert.equal(command.parameters.repositoryFullName, 'elansuministros-oss/elanvisual-platform');
  assert.equal(command.parameters.canonicalBranch, 'elanvisual-desde-elanpet');
  assert.equal(command.parameters.restart, false);
});

test('natural ELANVISUAL deploy does not collapse to CONNECT', () => {
  const command = detectSupervisorCommand(`ELAN despliega ELANVISUAL al commit ${SHA}`);
  assert.equal(command.target, 'elanvisual');
  assert.match(command.summary, /ELANVISUAL/);
});

test('ambiguous multi-target positive request remains rejected', () => {
  assert.equal(detectTarget('despliega CONNECT y ELANVISUAL'), null);
});
