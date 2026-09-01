'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatDetailedCustomerList,
  requestedCustomerFields
} = require('../services/ownerBusinessCustomerFieldsPatch');

test('Owner customer list request captures explicitly requested profile fields', () => {
  assert.deepEqual(
    requestedCustomerFields('Busca los clientes que tenemos registrados y dame nombre, teléfono y empresa de cada uno'),
    ['name', 'phone', 'companyName']
  );

  assert.deepEqual(
    requestedCustomerFields('Busca los clientes que tenemos registrados'),
    []
  );
});

test('Detailed official customer list renders requested fields and missing values explicitly', () => {
  const output = formatDetailedCustomerList({
    data: {
      count: 2,
      results: [
        { customer: { name: 'erick', companyName: 'ELANKAV', phone: '+505 8888 0000' } },
        { customer: { name: 'Dra. Abigail Brenes', companyName: 'Cirujanos Maxilofaciales de Nicaragua', phone: '+505 7607 6524' } }
      ]
    }
  }, ['name', 'phone', 'companyName']);

  assert.match(output, /Clientes oficiales registrados: 2/);
  assert.match(output, /1\. Dra\. Abigail Brenes/);
  assert.match(output, /Teléfono: \+505 7607 6524/);
  assert.match(output, /Empresa: Cirujanos Maxilofaciales de Nicaragua/);
  assert.match(output, /2\. erick/);
  assert.match(output, /Empresa: ELANKAV/);
});
