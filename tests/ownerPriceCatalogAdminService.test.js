'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMMAND_TYPE,
  detectOwnerPriceCatalogCommand,
  executeOwnerPriceCatalogCommand,
  inferFormula
} = require('../services/ownerPriceCatalogAdminService');
const gateway = require('../services/ownerBusinessProcessMessageGateway');

test('detecta preview y confirmación de reemplazo', () => {
  const preview = detectOwnerPriceCatalogCommand('ELAN reemplaza el catálogo de precios de ELANVISUAL con el catálogo maestro');
  assert.equal(preview.type, COMMAND_TYPE);
  assert.equal(preview.action, 'replace_preview');
  const confirm = detectOwnerPriceCatalogCommand('ELAN CONFIRMA REEMPLAZAR PRECIOS ELANVISUAL');
  assert.equal(confirm.action, 'replace_confirm');
});

test('detecta cambio de precio por m2 con referencia humana', () => {
  const command = detectOwnerPriceCatalogCommand('ELAN cambia el precio de lona banner Roland UV 13 oz a USD 13.50 por m²');
  assert.equal(command.type, COMMAND_TYPE);
  assert.equal(command.action, 'update_price');
  assert.equal(command.query, 'lona banner Roland UV 13 oz');
  assert.equal(command.amount, 13.5);
  assert.equal(command.currency, 'USD');
  assert.equal(command.formulaType, 'AREA_M2');
  assert.equal(inferFormula('C$ 1800 por pliego'), 'UNIDAD');
});

test('actualización sin unidad preserva la fórmula existente', async () => {
  const command = detectOwnerPriceCatalogCommand('ELAN cambia el precio de lona banner Roland UV 13 oz a USD 14');
  assert.equal(command.formulaType, null);
  const calls = [];
  await executeOwnerPriceCatalogCommand(command, async (path, options) => {
    calls.push({ path, options });
    return { data: { status: 'SAVED', product: { name: 'Lona banner Roland UV' } } };
  });
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].options.body, 'formulaType'), false);
});

test('detecta y crea tarifa nueva sin duplicar autoridad', async () => {
  const command = detectOwnerPriceCatalogCommand('ELAN agrega una tarifa nueva para DTF UV 40 x 100 cm a C$ 1800 por pliego');
  assert.equal(command.action, 'create_price');
  assert.equal(command.technology, 'DTF_UV');
  assert.equal(command.currency, 'NIO');
  assert.equal(command.amount, 1800);
  assert.equal(command.formulaType, 'UNIDAD');
  const calls = [];
  const result = await executeOwnerPriceCatalogCommand(command, async (path, options) => {
    calls.push({ path, options });
    return { data: { status: 'SAVED', product: { name: 'DTF UV 40 x 100 cm', sku: 'dtf-uv-dtf-uv-40-x-100-cm' } } };
  });
  assert.equal(calls[0].path, '/api/v1/business/vqs/pricing/catalog-admin/create');
  assert.equal(calls[0].options.body.formulaType, 'UNIDAD');
  assert.match(result.outputText, /Nueva tarifa creada/);
});

test('preview no muta y devuelve confirmación exacta', async () => {
  const calls = [];
  const result = await executeOwnerPriceCatalogCommand({ type: COMMAND_TYPE, action: 'replace_preview' }, async (path, options) => {
    calls.push({ path, options });
    return { data: { existing: 170, incoming: 110, uniqueSkus: 110, review: 7, technologies: { ROLAND_TRUEVIS_LG_MG_UV: 35 } } };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.match(result.outputText, /No modifiqué nada todavía/);
  assert.match(result.outputText, /ELAN CONFIRMA REEMPLAZAR PRECIOS ELANVISUAL/);
});

test('confirmación usa token de reemplazo controlado', async () => {
  const calls = [];
  await executeOwnerPriceCatalogCommand({ type: COMMAND_TYPE, action: 'replace_confirm' }, async (path, options) => {
    calls.push({ path, options });
    return { data: { removed: 170, inserted: 110, uniqueSkus: 110, review: 7, snapshotId: 'snap-1' } };
  });
  assert.equal(calls[0].path, '/api/v1/business/vqs/pricing/catalog-admin/replace');
  assert.deepEqual(calls[0].options.body, { confirm: 'REPLACE_ELANVISUAL_PRICES' });
});

test('ambigüedad de actualización no se resuelve inventando variante', async () => {
  const result = await executeOwnerPriceCatalogCommand({ type: COMMAND_TYPE, action: 'update_price', query: 'banner', amount: 12, currency: 'USD', formulaType: 'AREA_M2' }, async () => ({ data: { status: 'MULTIPLE', matches: [{ name: 'Banner Roland', sku: 'r1', currency: 'USD', pricePerM2: 12 }, { name: 'Banner Epson', sku: 'e1', currency: 'USD', pricePerM2: 10 }] } }));
  assert.match(result.outputText, /varias tarifas compatibles/);
  assert.match(result.outputText, /Banner Roland/);
  assert.match(result.outputText, /Banner Epson/);
});

test('gateway prioriza price catalog owner command', () => {
  const command = gateway.detectOwnerBusinessCommand('ELAN cambia el precio de lona banner Roland UV 13 oz a USD 13.50 por m²');
  assert.equal(command.type, COMMAND_TYPE);
  assert.equal(gateway.PRICE_CATALOG_ADMIN, COMMAND_TYPE);
});
