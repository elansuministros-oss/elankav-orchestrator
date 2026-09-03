'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const connectClient = fs.readFileSync(path.join(root, 'services/ownerBusinessConnectClient.js'), 'utf8');
const quotationService = fs.readFileSync(path.join(root, 'services/ownerQuotationService.js'), 'utf8');
const sellerClient = fs.readFileSync(path.join(root, 'services/sellerBusinessConnectClient.js'), 'utf8');
const { parseQuotationRequest } = require('../services/ownerQuotationService');

test('Owner price reads and quotation pricing use the canonical commercial_products runtime endpoints', () => {
  assert.match(connectClient, /\/api\/v1\/business\/vqs\/pricing\/resolve/);
  assert.match(connectClient, /\/api\/v1\/business\/vqs\/pricing\/catalog/);
  assert.doesNotMatch(connectClient, /pricing\/catalog-admin\/search/);
  assert.match(connectClient, /matches:Array\.isArray\(data\.items\)\?data\.items:\[\]/);
});

test('quotation documents preserve canonical pricing provenance', () => {
  assert.match(quotationService, /COMMERCIAL_PRODUCTS/);
  assert.match(quotationService, /CONNECT_COMMERCIAL_PRODUCTS/);
  assert.match(quotationService, /pricingAuthority/);
  assert.match(quotationService, /pricingMatchRule/);
  assert.doesNotMatch(quotationService, /MASTER_CATALOG/);
  assert.match(quotationService, /pricing:\s*\{[^}]*source:/s);
  assert.match(quotationService, /pricing:\s*\{[^}]*authority:/s);
});

test('seller quotations use the same canonical authority defaults', () => {
  assert.match(sellerClient, /CONNECT_COMMERCIAL_PRODUCTS/);
  assert.match(sellerClient, /COMMERCIAL_PRODUCTS/);
  assert.doesNotMatch(sellerClient, /CONNECT_AI_PLATFORM_PRICES/);
  assert.doesNotMatch(sellerClient, /AI_PLATFORM_PRICES_DIRECT/);
});

test('natural Owner quotation intake accepts an approved-service style request without a code command', () => {
  const input = parseQuotationRequest('ELAN cotizame vinil frost con impresión UV 2 x 1');
  assert.ok(input);
  assert.match(input.productQuery, /vinil frost con impresión uv/i);
  assert.equal(input.width, 2);
  assert.equal(input.height, 1);
  assert.equal(input.quantity, 1);
});

test('missing tariff language points to the growing commercial catalog, not a hidden library', () => {
  assert.match(quotationService, /agregamos esa tarifa al catálogo comercial/i);
  assert.doesNotMatch(quotationService, /No encontré .*biblioteca oficial/i);
});
