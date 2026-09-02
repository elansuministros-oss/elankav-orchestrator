'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  supplierCommand
} = require('../services/ownerSupplierProspectingPriorityPatch');

const REAL_OWNER_MESSAGE = `ELAN, buscá 200 proveedores para ELANVISUAL en Nicaragua relacionados con rótulos, producción gráfica, PVC, ACM, acrílico, vinil, impresión gran formato, impresión UV, serigrafía, sublimación, material POP, letras corpóreas, cajas de luz, LED, CNC, corte láser, metalmecánica, soldadura, instalación, transporte de carga, grúas, andamios y acabados gráficos.

Clasificalos por departamento, municipio o ciudad, ubicación, productos, servicios, capacidades y datos públicos de contacto.

Solo investigá y registrá prospectos de proveedores. No contactés a ninguno todavía.`;

test('prioriza la orden real de 200 proveedores como supplier prospecting', () => {
  const command = supplierCommand(REAL_OWNER_MESSAGE);
  assert.ok(command);
  assert.equal(command.type, 'business_prospecting_mission_create');
  assert.equal(command.input.targetCompanies, 200);
  assert.equal(command.input.prospectType, 'supplier');
  assert.match(command.input.mission, /SUPPLIER_PROSPECTING/);
  assert.match(command.input.mission, /no ejecutes outreach/i);
});

test('no secuestra una consulta de proveedor individual', () => {
  assert.equal(supplierCommand('ELAN, buscá el proveedor Vargas Centro'), null);
});

test('no secuestra una lista normal de proveedores oficiales', () => {
  assert.equal(supplierCommand('ELAN, mostrame los proveedores registrados'), null);
});
