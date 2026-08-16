'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../services/ownerBusinessQuotationItemPatch');
const {
  detectOwnerBusinessCommand
} = require('../services/ownerBusinessCommandService');

test('detecta agregar ítem a cotización por referencia humana', () => {
  const command = detectOwnerBusinessCommand(
    'ELAN buscá la cotización de la Dra. Abigail y después del centro de mesa agregá un rótulo estilo botón en acrílico de 60 x 60 cm. Buscá el precio autorizado y agregalo como nuevo ítem.'
  );

  assert.ok(command);
  assert.equal(command.type, 'business_quotation_item_add');
  assert.equal(command.input.customerReference, 'Abigail');
  assert.equal(command.input.anchorReference, 'centro de mesa');
  assert.equal(command.input.width, 0.6);
  assert.equal(command.input.height, 0.6);
  assert.match(command.input.productQuery, /rotulo estilo boton en acrilico/i);
});

test('conserva comandos empresariales existentes', () => {
  const command = detectOwnerBusinessCommand('ELAN busca cliente Dra. Abigail Brenes');
  assert.ok(command);
  assert.equal(command.type, 'business_customer_search');
});

test('no convierte operación de imagen en alta de ítem', () => {
  const command = detectOwnerBusinessCommand('ELAN agregá esta imagen a la cotización');
  assert.notEqual(command?.type, 'business_quotation_item_add');
});
