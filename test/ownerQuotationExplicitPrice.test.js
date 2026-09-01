'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasLogisticsIntent,
  parseQuotationRequest,
  resolveLogistics
} = require('../services/ownerQuotationService');

test('explicit Owner price does not request dimensions when logistics were not requested', async () => {
  const input = parseQuotationRequest(
    'ELAN cotizame para la Dra. Abigail Brenes un centro de mesa para dentista, precio USD 45, pago 60/40'
  );

  assert.equal(input.productQuery, 'un centro de mesa para dentista');
  assert.deepEqual(input.explicitPrice, { amount: 45, currency: 'USD' });
  assert.deepEqual(input.paymentTerms, { depositPercent: 60, balancePercent: 40 });
  assert.equal(input.logisticsRequested, false);

  const logistics = await resolveLogistics(input);
  assert.equal(logistics.ready, true);
  assert.equal(logistics.amount, 0);
  assert.equal(logistics.currency, 'USD');
});

test('logistics intent remains explicit when installation or delivery is requested', () => {
  assert.equal(hasLogisticsIntent('precio USD 300 instalado en Granada'), true);
  assert.equal(hasLogisticsIntent('precio USD 45 pago 60/40'), false);
});
