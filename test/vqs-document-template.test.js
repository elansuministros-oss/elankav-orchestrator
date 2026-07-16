const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertQuotationDocument,
  resolveQuotationTemplate
} = require('../services/vqs/documentTemplateService');

function createDocument(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    documentType: 'quotation',
    platformId: 'ELANVISUAL',
    quotationNumber: 'COT-EV-2026-0001',
    customer: { name: 'Cliente demo' },
    executive: {
      executiveId: 'EXEC-ERICK-CANO-001',
      name: 'Erick Cano',
      role: 'Director Comercial'
    },
    items: [
      {
        id: 'item-1',
        title: 'Rótulo luminoso',
        quantity: 1,
        unitPrice: 350,
        subtotal: 350,
        images: []
      }
    ],
    currency: 'USD',
    totals: { total: 350 },
    paymentTerms: {
      type: '60_40',
      installments: [
        { label: 'Anticipo', percentage: 60, amount: 210 },
        { label: 'Contra entrega', percentage: 40, amount: 140 }
      ]
    },
    internalData: {
      productionCost: 120,
      margin: 230
    },
    ...overrides
  };
}

test('valida un QuotationDocument correcto', () => {
  assert.deepEqual(assertQuotationDocument(createDocument()), []);
});

test('rechaza pagos personalizados que no suman 100%', () => {
  const document = createDocument({
    paymentTerms: {
      type: 'custom',
      installments: [
        { percentage: 50 },
        { percentage: 40 }
      ]
    }
  });

  assert.match(assertQuotationDocument(document).join(' '), /100%/);
});

test('resuelve branding y elimina información interna del documento público', () => {
  const result = resolveQuotationTemplate(createDocument());

  assert.equal(result.platformId, 'ELANVISUAL');
  assert.equal(result.brandSnapshot.website, 'https://visual.elankav.com');
  assert.equal(result.publicDocument.brandSnapshot.website, 'https://visual.elankav.com');
  assert.equal(result.publicDocument.brandSnapshot.logoForLightBackground, '/assets/branding/elanvisual.svg');
  assert.equal(result.publicDocument.internalData, undefined);
  assert.equal(result.publicDocument.paymentAccountsSnapshot.length, 4);
});

test('mantiene las cuatro cuentas oficiales de ELANVISUAL en el documento publico', () => {
  const result = resolveQuotationTemplate(createDocument());
  const accountIds = result.publicDocument.paymentAccountsSnapshot.map((account) => account.id);

  assert.deepEqual(accountIds, [
    'bac-nio-01',
    'lafise-nio-01',
    'lafise-usd-01',
    'banpro-usd-01'
  ]);
  assert.equal(result.publicDocument.paymentAccountsSnapshot[0].bankName, 'BAC Credomatic');
});
