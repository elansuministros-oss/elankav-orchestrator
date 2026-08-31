'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectOwnerUnifiedCommand
} = require('../services/elanUnifiedOwnerCommandService');

const {
  BUSINESS_COMMANDS,
  detectOwnerBusinessCommand
} = require('../services/ownerBusinessCommandService');

test('Unified Runtime defers standalone quotation lookup to Owner Business', () => {
  const message = 'ELAN busca la cotización del cliente polarizado';

  assert.equal(detectOwnerUnifiedCommand(message), null);

  const business = detectOwnerBusinessCommand(message);
  assert.equal(business?.type, BUSINESS_COMMANDS.QUOTATION_LOOKUP);
  assert.equal(business?.customerReference, 'polarizado');
});

test('Unified Runtime defers quotation lookup plus send to Owner Business', () => {
  const message = 'ELAN busca la cotización del cliente polarizado y envíale la cotización';

  assert.equal(detectOwnerUnifiedCommand(message), null);

  const business = detectOwnerBusinessCommand(message);
  assert.equal(business?.type, BUSINESS_COMMANDS.QUOTATION_LOOKUP_SEND);
  assert.equal(business?.customerReference, 'polarizado');
});

test('Unified Runtime keeps normal customer and provider searches', () => {
  const customer = detectOwnerUnifiedCommand('Busca cliente Abigail Brenes');
  assert.equal(customer?.tool, 'buscar_cliente');
  assert.equal(customer?.arguments?.query, 'Abigail Brenes');

  const provider = detectOwnerUnifiedCommand('Busca proveedor Vargas Centro');
  assert.equal(provider?.tool, 'buscar_proveedor');
  assert.equal(provider?.arguments?.query, 'Vargas Centro');
});
