'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REGISTRY_VERSION,
  getAuthorizedService,
  getServiceRegistrySnapshot
} = require('../services/serviceRegistryService');

test('registra ELANKAV Design Engine como servicio autorizado', () => {
  const service = getAuthorizedService('design-engine');

  assert.ok(service);
  assert.equal(service.name, 'ELANKAV Design Engine');
  assert.equal(service.state, 'REGISTERED');
  assert.equal(service.category, 'creative');
  assert.equal(service.access, 'elan-ia-via-orchestrator');
});

test('Design Engine permanece sin ejecución externa habilitada', () => {
  const service = getAuthorizedService('design-engine');

  assert.equal(service.capabilities.read, true);
  assert.equal(service.capabilities.write, false);
  assert.equal(service.capabilities.execute, false);
});

test('actualiza la versión y el conteo del Service Registry', () => {
  const snapshot = getServiceRegistrySnapshot();

  assert.equal(REGISTRY_VERSION, '1.2.0');
  assert.equal(
    snapshot.services.some(service => service.id === 'design-engine'),
    true
  );
});
