'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOwnerPriceCatalogCommand,
  executeOwnerPriceCatalogCommand
} = require('../services/ownerPriceCatalogAdminService');

test('detects exact bulk authorization confirmation command', () => {
  assert.deepEqual(
    detectOwnerPriceCatalogCommand('ELAN CONFIRMA AUTORIZAR PRECIOS ELANVISUAL'),
    { type: 'business_price_catalog_admin', action: 'authorize_all' }
  );
});

test('calls CONNECT controlled bulk authorization endpoint', async () => {
  const calls = [];
  const result = await executeOwnerPriceCatalogCommand(
    { type: 'business_price_catalog_admin', action: 'authorize_all' },
    async (path, options) => {
      calls.push({ path, options });
      return { data: { status: 'AUTHORIZED', total: 110, approved: 110, published: 110, active: 110, ownerOverridesApplied: 7, effectiveFrom: '2026-08-16' } };
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/business/vqs/pricing/catalog-admin/authorize-all');
  assert.deepEqual(calls[0].options.body, { confirm: 'AUTHORIZE_ELANVISUAL_PRICES' });
  assert.match(result.outputText, /Activos para ELAN: 110/);
  assert.match(result.outputText, /tarifas “desde” quedan como referencia mínima/i);
});
