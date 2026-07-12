'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectStart,
  isCancel,
  isConfirm,
  parseSupplierType,
  splitCategories
} = require('../services/crmConversationService');

test('detecta inicio de proveedor', () => {
  assert.equal(detectStart('Quiero agregar un proveedor'), 'supplier');
});

test('detecta inicio de cliente', () => {
  assert.equal(detectStart('Crear cliente para ELANVISUAL'), 'client');
});

test('reconoce confirmacion y cancelacion', () => {
  assert.equal(isConfirm('Sí'), true);
  assert.equal(isCancel('Cancelar'), true);
});

test('clasifica tipos de proveedor', () => {
  assert.equal(parseSupplierType('materia prima'), 'materials');
  assert.equal(parseSupplierType('servicios'), 'services');
  assert.equal(parseSupplierType('ambas cosas'), 'mixed');
});

test('separa categorias', () => {
  assert.deepEqual(splitCategories('lona, vinil y acrílico'), ['lona', 'vinil', 'acrílico']);
});
