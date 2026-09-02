'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectSupplierMissionStatus,
  formatSupplierAudit
} = require('../services/ownerSupplierMissionStatusPatch');

test('detecta estado de misión de proveedores con el mensaje real del Owner', () => {
  assert.equal(
    detectSupplierMissionStatus('ELAN, dame el estado de la misión 9ee69c23-584b-419a-8f48-dedafe16a88d y cuántos proveedores llevás encontrados.'),
    true
  );
});

test('detecta consulta corta de cantidad de proveedores', () => {
  assert.equal(detectSupplierMissionStatus('ELAN cuantos proveedores llevas encontrados'), true);
});

test('no captura búsqueda individual de proveedor', () => {
  assert.equal(detectSupplierMissionStatus('ELAN busca el proveedor Vargas Centro'), false);
});

test('formatea auditoría como proveedores y conserva estado', () => {
  const output = formatSupplierAudit({
    mission: {
      id: '9ee69c23-584b-419a-8f48-dedafe16a88d',
      status: 'partial',
      companiesFound: 37,
      targetCompanies: 200,
      contactsFound: 21
    }
  });
  assert.match(output, /Encontrados: 37 de 200 proveedores/);
  assert.match(output, /Estado: partial/);
  assert.match(output, /9ee69c23-584b-419a-8f48-dedafe16a88d/);
  assert.match(output, /Contacto comercial: pausado/);
});
