'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formalQuoteBlockForPricing } = require('../services/ownerQuotationService');

test('BASE_PRICE_ONLY never becomes a formal automatic quotation', () => {
  const result = formalQuoteBlockForPricing({
    status: 'BASE_PRICE_ONLY',
    item: {
      name: 'Rótulo estilo botón — desde',
      currency: 'USD',
      minimumPrice: 130
    }
  });

  assert.equal(result.ready, false);
  assert.equal(result.blocked, true);
  assert.equal(result.code, 'FORMAL_QUOTATION_FROM_PRICE_NOT_ALLOWED');
  assert.match(result.question, /no puede generar una cotización formal automática/i);
  assert.match(result.question, /Referencia mínima: USD 130\.00/i);
});

test('normal authorized fixed prices remain eligible for formal quotation', () => {
  assert.equal(formalQuoteBlockForPricing({ status: 'FOUND' }), null);
});

test('an explicit final Owner price is not treated as the catalog DESDE price', () => {
  assert.equal(
    formalQuoteBlockForPricing(
      { status: 'BASE_PRICE_ONLY', item: { name: 'Producto desde', minimumPrice: 100 } },
      { amount: 175, currency: 'USD' }
    ),
    null
  );
});
