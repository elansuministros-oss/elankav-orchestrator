'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const connectClient = require('../services/ownerBusinessConnectClient');
const contextService = require('../services/ownerBusinessContextService');
const mediaService = require('../services/ownerQuotationMediaService');

const originals = {
  searchCustomers: connectClient.searchCustomers,
  listQuotations: connectClient.listQuotations,
  readContext: contextService.readContext,
  updateContext: contextService.updateContext,
  addItemByHumanReference: mediaService.addItemByHumanReference
};

function restore() {
  connectClient.searchCustomers = originals.searchCustomers;
  connectClient.listQuotations = originals.listQuotations;
  contextService.readContext = originals.readContext;
  contextService.updateContext = originals.updateContext;
  mediaService.addItemByHumanReference = originals.addItemByHumanReference;
  delete require.cache[require.resolve('../services/ownerQuotationHomonymResolver')];
}

test.afterEach(restore);

test('usa el item ancla para resolver clientes homonimos sin pedir UUID ni nombre adicional', async () => {
  let savedContext = null;
  const transactionInputs = [];

  connectClient.searchCustomers = async () => ({
    data: {
      results: [
        { customer: { customerId: 'customer-a', name: 'Dra. Abigail Brenes' } },
        { customer: { customerId: 'customer-b', name: 'Dra. Abigail Brenes' } }
      ]
    }
  });

  connectClient.listQuotations = async () => ({
    data: [
      {
        customer_id: 'customer-a',
        project_id: 'project-other',
        quotation_id: 'quotation-other',
        quotation_number: 'COT-OTHER',
        status: 'draft',
        quotation_document: {
          publicDocument: {
            items: [{ title: 'Rótulo exterior', description: 'Rótulo exterior' }]
          }
        }
      },
      {
        customer_id: 'customer-b',
        project_id: 'project-abigail',
        quotation_id: 'quotation-abigail',
        quotation_number: 'COT-2026-7B538F22',
        status: 'draft',
        quotation_document: {
          publicDocument: {
            items: [{ title: 'Centro de mesa para dentista', description: 'centro de mesa para dentista' }]
          }
        }
      }
    ]
  });

  contextService.readContext = async () => ({});
  contextService.updateContext = async patch => {
    savedContext = patch;
    return patch;
  };

  mediaService.addItemByHumanReference = async input => {
    transactionInputs.push(input);
    if (input.customerReference) {
      return {
        handled: true,
        status: 'clarification_required',
        outputText: 'Encontré varios clientes que coinciden con “Abigail”: Dra. Abigail Brenes, Dra. Abigail Brenes. Decime cuál corresponde.'
      };
    }
    return {
      handled: true,
      status: 'completed',
      outputText: '✅ Ítem agregado en COT-2026-7B538F22.'
    };
  };

  delete require.cache[require.resolve('../services/ownerQuotationHomonymResolver')];
  const { addItemByHumanReference } = require('../services/ownerQuotationHomonymResolver');

  const result = await addItemByHumanReference({
    customerReference: 'Abigail',
    anchorReference: 'centro de mesa',
    requestedDescription: 'rótulo estilo botón en acrílico de 60 x 60 cm',
    productQuery: 'rotulo estilo boton en acrilico',
    width: 0.6,
    height: 0.6,
    quantity: 1
  });

  assert.equal(result.status, 'completed');
  assert.equal(transactionInputs.length, 2);
  assert.equal(transactionInputs[0].customerReference, 'Abigail');
  assert.equal(transactionInputs[1].customerReference, '');
  assert.equal(savedContext.activeCustomerId, 'customer-b');
  assert.equal(savedContext.activeProjectId, 'project-abigail');
  assert.equal(savedContext.activeQuotationId, 'quotation-abigail');
  assert.equal(savedContext.activeQuotationNumber, 'COT-2026-7B538F22');
});

test('mantiene la pregunta si el item ancla sigue siendo ambiguo entre varias cotizaciones', async () => {
  connectClient.searchCustomers = async () => ({
    data: {
      results: [
        { customer: { customerId: 'customer-a', name: 'Dra. Abigail Brenes' } },
        { customer: { customerId: 'customer-b', name: 'Dra. Abigail Brenes' } }
      ]
    }
  });

  connectClient.listQuotations = async () => ({
    data: ['customer-a', 'customer-b'].map((id, index) => ({
      customer_id: id,
      project_id: `project-${index}`,
      quotation_id: `quotation-${index}`,
      status: 'draft',
      quotation_document: {
        publicDocument: {
          items: [{ title: 'Centro de mesa', description: 'centro de mesa' }]
        }
      }
    }))
  });

  contextService.readContext = async () => ({});
  contextService.updateContext = async () => {
    throw new Error('NO_DEBE_ACTUALIZAR_CONTEXTO');
  };

  mediaService.addItemByHumanReference = async () => ({
    handled: true,
    status: 'clarification_required',
    outputText: 'Encontré varios clientes que coinciden con “Abigail”: Dra. Abigail Brenes, Dra. Abigail Brenes. Decime cuál corresponde.'
  });

  delete require.cache[require.resolve('../services/ownerQuotationHomonymResolver')];
  const { addItemByHumanReference } = require('../services/ownerQuotationHomonymResolver');

  const result = await addItemByHumanReference({
    customerReference: 'Abigail',
    anchorReference: 'centro de mesa'
  });

  assert.equal(result.status, 'clarification_required');
  assert.match(result.outputText, /varios clientes/i);
});
