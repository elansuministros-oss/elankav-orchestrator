'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSupplierInput
} = require('../services/supplierService');
const {
  normalizePlatform,
  normalizeClientInput
} = require('../services/clientService');

test('normaliza proveedor de materiales', () => {
  const result = normalizeSupplierInput({
    name: ' Vargas Centro ',
    supplierType: 'MATERIALS',
    categories: [' vinil ', 'lona']
  });

  assert.equal(result.name, 'Vargas Centro');
  assert.equal(result.supplierType, 'materials');
  assert.deepEqual(result.categories, ['vinil', 'lona']);
});

test('rechaza proveedor sin nombre', () => {
  assert.throws(
    () => normalizeSupplierInput({ supplierType: 'services' }),
    error => error.code === 'SUPPLIER_NAME_REQUIRED'
  );
});

test('rechaza tipo de proveedor invalido', () => {
  assert.throws(
    () => normalizeSupplierInput({ name: 'X', supplierType: 'other' }),
    error => error.code === 'SUPPLIER_TYPE_INVALID'
  );
});

test('normaliza plataforma de cliente', () => {
  assert.equal(normalizePlatform('ELAN VISUAL'), 'elanvisual');
  assert.equal(normalizePlatform('ELANPET'), 'elanpet');
});

test('valida cliente con plataforma', () => {
  const result = normalizeClientInput({
    name: ' Comercial San Jose ',
    platform: 'ELANVISUAL',
    phone: '8888-7777'
  });

  assert.equal(result.name, 'Comercial San Jose');
  assert.equal(result.platform, 'elanvisual');
  assert.equal(result.phone, '8888-7777');
});

test('rechaza cliente sin plataforma', () => {
  assert.throws(
    () => normalizeClientInput({ name: 'Cliente X' }),
    error => error.code === 'CLIENT_PLATFORM_REQUIRED'
  );
});
