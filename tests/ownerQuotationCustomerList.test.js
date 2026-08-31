'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadService() {
  const connectPath = require.resolve('../services/ownerBusinessConnectClient');
  const contextPath = require.resolve('../services/ownerBusinessContextService');
  const confirmPath = require.resolve('../services/ownerOpsConfirmationService');
  const auditPath = require.resolve('../services/ownerOpsAuditService');
  const quotationPath = require.resolve('../services/ownerQuotationService');
  const wahaPath = require.resolve('../adapters/wahaDeliveryAdapter');
  const servicePath = require.resolve('../services/ownerBusinessCommandService');

  const saved = new Map([
    [connectPath, require.cache[connectPath]],
    [contextPath, require.cache[contextPath]],
    [confirmPath, require.cache[confirmPath]],
    [auditPath, require.cache[auditPath]],
    [quotationPath, require.cache[quotationPath]],
    [wahaPath, require.cache[wahaPath]],
    [servicePath, require.cache[servicePath]]
  ]);

  const contextUpdates = [];

  const rows = [
    {
      projectId: 'project-split-2',
      quotationId: 'quotation-split-2',
      quotationNumber: 'COT-SPLIT-2',
      status: 'draft',
      totalUsd: 2350,
      createdAt: '2026-08-31T22:02:00.000Z',
      quotation_document: {
        publicDocument: {
          customer: { name: 'POLARIZADO', companyName: 'POLARIZADO' },
          project: { title: 'Rotulación POLARIZADO — Alternativa 2: Cajuela PVC 6 mm' },
          items: [{ title: 'Cajuela PVC 6 mm' }],
          totals: { totalUsd: 2350 }
        }
      }
    },
    {
      projectId: 'project-split-1',
      quotationId: 'quotation-split-1',
      quotationNumber: 'COT-SPLIT-1',
      status: 'draft',
      totalUsd: 1650,
      createdAt: '2026-08-31T22:01:00.000Z',
      quotation_document: {
        publicDocument: {
          customer: { name: 'POLARIZADO', companyName: 'POLARIZADO' },
          project: { title: 'Rotulación POLARIZADO — Alternativa 1: PVC 10 mm' },
          items: [{ title: 'PVC expandido 10 mm' }],
          totals: { totalUsd: 1650 }
        }
      }
    },
    {
      projectId: 'project-other',
      quotationId: 'quotation-other',
      quotationNumber: 'COT-OTHER',
      status: 'draft',
      totalUsd: 100,
      createdAt: '2026-08-31T21:00:00.000Z',
      quotation_document: {
        publicDocument: {
          customer: { name: 'OTRO CLIENTE' },
          items: [{ title: 'Otro trabajo' }],
          totals: { totalUsd: 100 }
        }
      }
    }
  ];

  require.cache[connectPath] = {
    id: connectPath,
    filename: connectPath,
    loaded: true,
    exports: {
      createCustomer: async () => ({}),
      createLogisticsRule: async () => ({}),
      listCustomers: async () => ({ data: { results: [] } }),
      listProviders: async () => [],
      listQuotations: async () => ({ data: rows }),
      searchCustomers: async () => ({ data: { results: [] } }),
      searchProviders: async () => []
    }
  };

  require.cache[contextPath] = {
    id: contextPath,
    filename: contextPath,
    loaded: true,
    exports: {
      readContext: async () => ({}),
      updateContext: async patch => {
        contextUpdates.push(patch);
        return patch;
      }
    }
  };

  require.cache[confirmPath] = {
    id: confirmPath,
    filename: confirmPath,
    loaded: true,
    exports: {
      createPendingOperation: async input => ({ id: 'OPS-TEST', ...input }),
      formatPendingOperation: operation => 'CONFIRMAR ' + operation.id
    }
  };

  require.cache[auditPath] = {
    id: auditPath,
    filename: auditPath,
    loaded: true,
    exports: { recordAuditSafely: async () => {} }
  };

  require.cache[quotationPath] = {
    id: quotationPath,
    filename: quotationPath,
    loaded: true,
    exports: {
      parseQuotationRequest: () => null,
      prepareAndCreateQuotation: async () => ({ ready: false, question: 'stub' })
    }
  };

  require.cache[wahaPath] = {
    id: wahaPath,
    filename: wahaPath,
    loaded: true,
    exports: {
      createWahaDeliveryAdapter: () => ({ sendText: async () => ({}) }),
      normalizePhone: value => String(value || '').replace(/\D/g, '')
    }
  };

  delete require.cache[servicePath];
  const service = require('../services/ownerBusinessCommandService');

  function cleanup() {
    for (const [path, value] of saved.entries()) {
      delete require.cache[path];
      if (value) require.cache[path] = value;
    }
  }

  return { service, contextUpdates, cleanup };
}

test('lists only the quotations of the requested customer and remembers the result set', async () => {
  const { service, contextUpdates, cleanup } = loadService();

  try {
    const command = service.detectOwnerBusinessCommand(
      'BUSCA LAS COTIZACIONES DEL CLIENTE POLARIZADO QUE HAY'
    );

    assert.equal(command.type, service.BUSINESS_COMMANDS.QUOTATION_CUSTOMER_LIST);
    assert.equal(command.customerReference, 'polarizado');

    const result = await service.executeOwnerBusinessCommand(command);

    assert.equal(result.handled, true);
    assert.equal(result.result.status, 'found');
    assert.equal(result.result.rows.length, 2);
    assert.match(result.outputText, /Cotizaciones de POLARIZADO: 2/);
    assert.match(result.outputText, /COT-SPLIT-1/);
    assert.match(result.outputText, /COT-SPLIT-2/);
    assert.doesNotMatch(result.outputText, /COT-OTHER/);

    assert.equal(contextUpdates.length, 1);
    assert.equal(contextUpdates[0].activeCustomerReference, 'POLARIZADO');
    assert.equal(contextUpdates[0].lastIntent, 'quotation_list_by_customer');
    assert.deepEqual(
      contextUpdates[0].lastQuotationNumbers,
      ['COT-SPLIT-2', 'COT-SPLIT-1']
    );
    assert.deepEqual(
      contextUpdates[0].lastQuotationIds,
      ['quotation-split-2', 'quotation-split-1']
    );
  } finally {
    cleanup();
  }
});
