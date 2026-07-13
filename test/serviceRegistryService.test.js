'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAuthorizedService,
  getServiceRegistrySnapshot,
  listAuthorizedServices
} = require('../services/serviceRegistryService');

test('registro contiene servicios oficiales sin duplicados', () => {
  const services = listAuthorizedServices();
  const ids = services.map(service => service.id);

  assert.equal(services.length, 11);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('github'));
  assert.ok(ids.includes('docker'));
  assert.ok(ids.includes('documentation'));
  assert.ok(ids.includes('vscode-web'));
});

test('registro diferencia integrado de registrado', () => {
  const snapshot = getServiceRegistrySnapshot();

  assert.equal(snapshot.mode, 'read-only');
  assert.equal(snapshot.count, 11);
  assert.equal(snapshot.integrated, 8);
  assert.equal(snapshot.registered, 3);
});

test('documentación integra lectura sin habilitar escritura todavía', () => {
  const documentation = getAuthorizedService('documentation');

  assert.equal(documentation.state, 'INTEGRATED');
  assert.deepEqual(documentation.permissions, [
    'documentation.read',
    'documentation.write'
  ]);
  assert.equal(documentation.capabilities.read, true);
  assert.equal(documentation.capabilities.write, false);
  assert.equal(documentation.capabilities.execute, false);
  assert.equal(documentation.access, 'orchestrator-only');
});

test('consulta devuelve copia y no permite mutar el registro', () => {
  const first = getAuthorizedService('github');
  first.permissions.push('github.admin');
  first.capabilities.write = true;

  const second = getAuthorizedService('github');

  assert.deepEqual(second.permissions, ['github.read']);
  assert.equal(second.capabilities.write, false);
});

test('servicio desconocido devuelve null', () => {
  assert.equal(getAuthorizedService('unknown-service'), null);
  assert.equal(getAuthorizedService(''), null);
});
