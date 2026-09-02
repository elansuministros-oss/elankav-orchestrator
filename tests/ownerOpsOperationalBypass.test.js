'use strict';

const assert = require('node:assert/strict');

const {
  detectSupervisorCommand
} = require('../services/ownerOpsSupervisorCommandPatch');

const deploy = detectSupervisorCommand([
  'ELAN, despliega ORCHESTRATOR.',
  'Repositorio exacto: elankav-orchestrator',
  'Rama exacta: stable/ORCHESTRATOR-WHATSAPP-CORE',
  'Commit exacto: bd9f93edb628e7865ea687caefa513988c450269',
  'No tocar CONNECT.',
  'No reiniciar WAHA directamente.'
].join('\n'));

assert.equal(deploy?.capability, 'repository.deploy');
assert.equal(deploy?.target, 'orchestrator');
assert.equal(deploy?.parameters?.expectedCommit, 'bd9f93edb628e7865ea687caefa513988c450269');

const elanvisual = detectSupervisorCommand([
  'ELAN despliega ELANVISUAL al commit ca314d1671f3b7b67ffe1f3a13e0ad4befb42d28',
  'No tocar CONNECT.',
  'No tocar ORCHESTRATOR.'
].join('\n'));

assert.equal(elanvisual?.capability, 'repository.deploy');
assert.equal(elanvisual?.target, 'elanvisual');
assert.equal(elanvisual?.parameters?.canonicalBranch, 'elanvisual-desde-elanpet');

console.log('OWNER_OPS_OPERATIONAL_BYPASS_OK');
