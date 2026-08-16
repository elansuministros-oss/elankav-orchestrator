'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUSINESS_COMMANDS,
  detectOwnerBusinessCommand,
  formatCustomerList,
  parseCustomerList
} = require('../services/ownerBusinessCommandService');

test('detecta listado general de clientes sin pedir aclaracion', () => {
  const command = detectOwnerBusinessCommand('Busca los clientes que tenemos registrados');
  assert.equal(command?.type, BUSINESS_COMMANDS.CUSTOMER_LIST);
  assert.equal(command?.sort, 'alphabetical');
  assert.equal(command?.countOnly, false);
});

test('detecta consulta de cantidad de clientes', () => {
  const command = parseCustomerList('Cuantos clientes tenemos');
  assert.equal(command?.type, BUSINESS_COMMANDS.CUSTOMER_LIST);
  assert.equal(command?.countOnly, true);
});

test('no interfiere con busqueda de un cliente especifico', () => {
  const command = detectOwnerBusinessCommand('Busca cliente Abigail Brenes');
  assert.equal(command?.type, BUSINESS_COMMANDS.CUSTOMER_SEARCH);
  assert.equal(command?.query, 'abigail brenes');
});

test('formatea cantidad y orden alfabetico', () => {
  const text = formatCustomerList({
    data: {
      count: 3,
      results: [
        { customer: { name: 'Carlos Gomez' } },
        { customer: { name: 'Abigail Brenes', companyName: 'Clinica Abigail' } },
        { customer: { name: 'Beatriz Lopez' } }
      ]
    }
  });

  assert.match(text, /Clientes oficiales registrados: 3/);
  const abigail = text.indexOf('Abigail Brenes');
  const beatriz = text.indexOf('Beatriz Lopez');
  const carlos = text.indexOf('Carlos Gomez');
  assert.ok(abigail < beatriz && beatriz < carlos);
});
