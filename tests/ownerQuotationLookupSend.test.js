'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BUSINESS_COMMANDS,
  detectOwnerBusinessCommand,
  parseQuotationLookupSend,
  parseQuotationReadRequest,
  selectQuotationByCustomerReference
} = require('../services/ownerBusinessCommandService');

test('detects natural quotation lookup + send request before customer search', () => {
  const command = detectOwnerBusinessCommand(
    'ELAN busca la cotización del cliente polarizado y envíale la cotización'
  );

  assert.deepEqual(command, {
    type: BUSINESS_COMMANDS.QUOTATION_LOOKUP_SEND,
    customerReference: 'polarizado'
  });

  assert.deepEqual(parseQuotationLookupSend(
    'Busca la cotización del cliente POLARIZADO y mándale la cotización'
  ), {
    type: BUSINESS_COMMANDS.QUOTATION_LOOKUP_SEND,
    customerReference: 'polarizado'
  });
});

test('selects the only draft quotation for the referenced customer', () => {
  const payload = {
    data: {
      quotations: [
        {
          id: 'q-old',
          projectId: 'p-old',
          quotationNumber: 'COT-OLD',
          status: 'sent',
          customerName: 'POLARIZADO'
        },
        {
          id: 'q-draft',
          projectId: 'p-draft',
          quotationNumber: 'COT-DRAFT',
          status: 'draft',
          customerName: 'POLARIZADO'
        }
      ]
    }
  };

  const resolved = selectQuotationByCustomerReference(payload, 'polarizado');
  assert.equal(resolved.status, 'selected');
  assert.equal(resolved.row.id, 'q-draft');
});

test('does not guess when multiple draft quotations exist', () => {
  const payload = {
    quotations: [
      { id: 'q-1', projectId: 'p-1', quotationNumber: 'COT-1', status: 'draft', customerName: 'POLARIZADO' },
      { id: 'q-2', projectId: 'p-2', quotationNumber: 'COT-2', status: 'draft', customerName: 'POLARIZADO' }
    ]
  };

  const resolved = selectQuotationByCustomerReference(payload, 'polarizado');
  assert.equal(resolved.status, 'ambiguous');
  assert.equal(resolved.candidates.length, 2);
});


test('detects latest quotation read requests deterministically', () => {
  assert.deepEqual(
    parseQuotationReadRequest('ELAN cuál es la última cotización'),
    {
      type: BUSINESS_COMMANDS.QUOTATION_LATEST,
      limit: 1
    }
  );

  assert.deepEqual(
    detectOwnerBusinessCommand('ELAN cual fue la cotizacion mas reciente'),
    {
      type: BUSINESS_COMMANDS.QUOTATION_LATEST,
      limit: 1
    }
  );
});

test('detects recent quotations list requests', () => {
  assert.deepEqual(
    parseQuotationReadRequest('ELAN mostrame las ultimas cotizaciones'),
    {
      type: BUSINESS_COMMANDS.QUOTATION_RECENT,
      limit: 5
    }
  );
});
