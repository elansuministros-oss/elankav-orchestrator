'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FALLBACK_PRODUCTS,
  calculateCommercialPrice,
  findMeasurements,
  findProduct,
  getCommercialKnowledgeState,
  mapRow
} = require('../services/commercialKnowledgeService');

test('BCO-01 mantiene fallback oficial mientras Supabase no carga', () => {
  const state = getCommercialKnowledgeState();
  assert.equal(state.source, 'fallback');
  assert.equal(state.products >= 1, true);
});

test('BCO-01 resuelve jala vista por alias', () => {
  const product = findProduct({
    message: 'Quiero información del rótulo jala vista doble cara',
    platformId: 'ELANVISUAL'
  });

  assert.equal(product.productCode, 'JALAVISTA_DOBLE');
  assert.deepEqual(findMeasurements(product), { widthCm: 60, heightCm: 60 });
});

test('BCO-01 calcula precio internamente sin exponer la regla', () => {
  const pricing = calculateCommercialPrice(FALLBACK_PRODUCTS[0], {
    widthCm: 80,
    heightCm: 40
  });

  assert.equal(pricing.amount, 290);
  assert.equal(pricing.widthSteps, 2);
  assert.equal(pricing.heightSteps, 0);
});

test('BCO-01 transforma fila Supabase al contrato oficial', () => {
  const product = mapRow({
    platform_id: 'ELANVISUAL',
    product_code: 'TEST-01',
    product_name: 'Producto prueba',
    aliases: ['prueba'],
    standard_width_cm: 50,
    standard_height_cm: 30,
    advertised_price_usd: 100,
    pricing_rules: {
      type: 'dimension-step',
      stepCm: 10,
      incrementUsd: 5,
      minimumPriceUsd: 100
    },
    materials: ['acrílico'],
    active: true
  });

  assert.equal(product.productCode, 'TEST-01');
  assert.deepEqual(product.standardDimensions, { widthCm: 50, heightCm: 30 });
  assert.deepEqual(product.materials, ['acrílico']);
});
