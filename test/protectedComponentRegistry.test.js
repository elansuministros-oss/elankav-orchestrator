'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_CONTRACTS,
  getProtectedComponentsForTarget,
  loadProtectedComponentRegistry
} = require('../services/protectedComponentRegistry');
const {
  getProtectedContractSpec
} = require('../services/protectedComponentContracts');

test('registro central contiene componentes críticos sin contratos arbitrarios', () => {
  const registry = loadProtectedComponentRegistry();
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.components.length, 6);

  const ids = new Set(registry.components.map(item => item.id));
  for (const id of [
    'OWNER_WHATSAPP_CORE',
    'OWNER_PROSPECTING_BRIDGE',
    'PROVIDER_RECRUITMENT_ORCHESTRATOR',
    'PROSPECTING_RESEARCH_AUTOPILOT',
    'PROVIDER_RECRUITMENT_CONNECT',
    'ELAN_GO_CONTROL'
  ]) {
    assert.equal(ids.has(id), true, id);
  }

  for (const component of registry.components) {
    assert.equal(ALLOWED_CONTRACTS.has(component.contract), true);
    assert.equal(component.critical, true);
    assert.ok(getProtectedContractSpec(component.contract));
  }
});

test('cada despliegue protegido tiene contratos por target', () => {
  const orchestrator = getProtectedComponentsForTarget('orchestrator');
  const connect = getProtectedComponentsForTarget('connect');

  assert.deepEqual(
    orchestrator.map(item => item.id).sort(),
    [
      'OWNER_PROSPECTING_BRIDGE',
      'OWNER_WHATSAPP_CORE',
      'PROVIDER_RECRUITMENT_ORCHESTRATOR'
    ].sort()
  );

  assert.deepEqual(
    connect.map(item => item.id).sort(),
    [
      'ELAN_GO_CONTROL',
      'PROSPECTING_RESEARCH_AUTOPILOT',
      'PROVIDER_RECRUITMENT_CONNECT'
    ].sort()
  );

});

test('contrato no permitido falla cerrado', () => {
  assert.throws(
    () => getProtectedContractSpec('shell_anything'),
    error => error?.code === 'PROTECTED_COMPONENT_CONTRACT_NOT_IMPLEMENTED'
  );
});


test('bootstrap phase intentionally defers Langflow protected registry', () => {
  const registry = loadProtectedComponentRegistry();
  assert.equal(registry.components.some(item => item.id === 'ELAN_LANGFLOW_POC'), false);
  // Runtime code may understand the future target already; the registry entry is
  // deferred so the currently-running legacy supervisor can validate this commit.
});
