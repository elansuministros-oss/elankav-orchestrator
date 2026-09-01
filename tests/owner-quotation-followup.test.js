'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseExplicitPrice,
  parsePaymentTerms,
  parseProductQuery,
  parseQuotationRequest,
  parseQuotationSendFollowup
} = require('../services/ownerQuotationService');

test('parses Owner explicit final price and 60/40 terms', () => {
  const input = parseQuotationRequest(
    'ELAN cotiza rótulo estilo botón 2x1 instalado en Granada precio USD 300 condiciones de pago 60/40'
  );

  assert.ok(input);
  assert.equal(input.productQuery, 'rótulo estilo botón');
  assert.equal(input.width, 2);
  assert.equal(input.height, 1);
  assert.equal(input.destination, 'Granada');
  assert.deepEqual(input.explicitPrice, { amount: 300, currency: 'USD' });
  assert.deepEqual(input.paymentTerms, { depositPercent: 60, balancePercent: 40 });
  assert.equal(input.priceIncludesLogistics, true);
});

test('recognizes córdobas and custom payment split', () => {
  assert.deepEqual(parseExplicitPrice('precio C$ 12500'), { amount: 12500, currency: 'NIO' });
  assert.deepEqual(parsePaymentTerms('condiciones 70/30'), { depositPercent: 70, balancePercent: 30 });
});

test('cleans commercial tails from product query', () => {
  assert.equal(
    parseProductQuery('cotiza rótulo luminoso 1x1 precio USD 250 condiciones 60/40'),
    'rótulo luminoso'
  );
});

test('recognizes active quotation send follow-ups', () => {
  assert.equal(parseQuotationSendFollowup('mandásela'), true);
  assert.equal(parseQuotationSendFollowup('ELAN envía la cotización al cliente'), true);
  assert.equal(parseQuotationSendFollowup('revisa la cotización'), false);

  const input = parseQuotationRequest('mandásela');
  assert.deepEqual(input, { sendActive: true, message: 'mandásela' });
});
