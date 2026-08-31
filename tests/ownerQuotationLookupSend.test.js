'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BUSINESS_COMMANDS,
  detectOwnerBusinessCommand,
  parseQuotationLookup,
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


test('detects standalone quotation lookup without changing send routing', () => {
  assert.deepEqual(
    detectOwnerBusinessCommand('ELAN busca la cotización del cliente polarizado'),
    {
      type: BUSINESS_COMMANDS.QUOTATION_LOOKUP,
      customerReference: 'polarizado'
    }
  );

  assert.deepEqual(
    parseQuotationLookup('Busca la cotización del cliente POLARIZADO'),
    {
      type: BUSINESS_COMMANDS.QUOTATION_LOOKUP,
      customerReference: 'polarizado'
    }
  );

  assert.equal(
    parseQuotationLookup('Busca la cotización del cliente POLARIZADO y envíale la cotización'),
    null,
    'el envío debe seguir reservado al handler QUOTATION_LOOKUP_SEND'
  );
});

test('matches CONNECT production payload by company name without hiding customer name', () => {
  const payload = {
    data: [
      {
        projectId: '407eb279-05e9-4506-b46e-5f75b951653a',
        quotationId: '31f90973-56c6-42e6-943c-b70cad4ea343',
        quotationNumber: 'COT-2026-31F90973',
        status: 'draft',
        createdAt: '2026-08-31T20:52:35.244442+00:00',
        quotation_document: {
          publicDocument: {
            customer: {
              name: 'Erick Cano',
              companyName: 'POLARIZADO'
            },
            totals: { totalUsd: 4000 }
          }
        }
      }
    ]
  };

  const resolved = selectQuotationByCustomerReference(payload, 'polarizado');
  assert.equal(resolved.status, 'selected');
  assert.equal(resolved.row.quotationNumber, 'COT-2026-31F90973');
});

test('quotation lookup does not intercept existing customer search', () => {
  const command = detectOwnerBusinessCommand('Busca cliente Abigail Brenes');
  assert.equal(command?.type, BUSINESS_COMMANDS.CUSTOMER_SEARCH);
  assert.equal(command?.query, 'abigail brenes');
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
