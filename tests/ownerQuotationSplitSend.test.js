'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadService({ rows, context } = {}) {
  const connectPath = require.resolve('../services/ownerBusinessConnectClient');
  const contextPath = require.resolve('../services/ownerBusinessContextService');
  const confirmPath = require.resolve('../services/ownerOpsConfirmationService');
  const auditPath = require.resolve('../services/ownerOpsAuditService');
  const quoteServicePath = require.resolve('../services/ownerQuotationService');
  const wahaPath = require.resolve('../adapters/wahaDeliveryAdapter');
  const servicePath = require.resolve('../services/ownerBusinessCommandService');

  const saved = new Map([
    [connectPath, require.cache[connectPath]],
    [contextPath, require.cache[contextPath]],
    [confirmPath, require.cache[confirmPath]],
    [auditPath, require.cache[auditPath]],
    [quoteServicePath, require.cache[quoteServicePath]],
    [wahaPath, require.cache[wahaPath]],
    [servicePath, require.cache[servicePath]]
  ]);

  const pendingCalls = [];
  let opCounter = 0;

  require.cache[connectPath] = {
    id: connectPath,
    filename: connectPath,
    loaded: true,
    exports: {
      createCustomer: async () => ({}),
      createLogisticsRule: async () => ({}),
      listCustomers: async () => ({ data: { results: [] } }),
      listProviders: async () => [],
      listQuotations: async () => ({ data: rows || [] }),
      searchCustomers: async () => ({ data: { results: [] } }),
      searchProviders: async () => []
    }
  };

  require.cache[contextPath] = {
    id: contextPath,
    filename: contextPath,
    loaded: true,
    exports: {
      readContext: async () => context || {},
      updateContext: async value => value
    }
  };

  require.cache[confirmPath] = {
    id: confirmPath,
    filename: confirmPath,
    loaded: true,
    exports: {
      createPendingOperation: async input => {
        pendingCalls.push(input);
        opCounter += 1;
        return {
          id: `OPS-TEST-${opCounter}`,
          task: input.summary,
          result: {
            operation: {
              capability: input.capability,
              target: input.target,
              impact: input.impact,
              parameters: input.parameters,
              expiresAt: '2026-08-31T22:30:00.000Z'
            }
          }
        };
      },
      formatPendingOperation: job => `CONFIRMAR ${job.id}`
    }
  };

  require.cache[auditPath] = {
    id: auditPath,
    filename: auditPath,
    loaded: true,
    exports: { recordAuditSafely: async () => {} }
  };

  require.cache[quoteServicePath] = {
    id: quoteServicePath,
    filename: quoteServicePath,
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

  return { service, pendingCalls, cleanup };
}

function splitRows({ secondStatus = 'draft', secondGroup = null } = {}) {
  const group = '31f90973-56c6-42e6-943c-b70cad4ea343';
  return [
    {
      projectId: 'child-project-1',
      quotationId: 'child-quotation-1',
      quotationNumber: 'COT-SPLIT-1',
      status: 'draft',
      createdAt: '2026-08-31T22:00:01.000Z',
      quotation_document: {
        publicDocument: {
          customer: { name: 'POLARIZADO', companyName: 'POLARIZADO' },
          relations: { splitGroupId: group, splitPartIndex: 1 },
          items: [{ title: 'PVC expandido 10 mm' }],
          totals: { totalUsd: 1650 }
        }
      }
    },
    {
      projectId: 'child-project-2',
      quotationId: 'child-quotation-2',
      quotationNumber: 'COT-SPLIT-2',
      status: secondStatus,
      createdAt: '2026-08-31T22:00:02.000Z',
      quotation_document: {
        publicDocument: {
          customer: { name: 'POLARIZADO', companyName: 'POLARIZADO' },
          relations: { splitGroupId: secondGroup || group, splitPartIndex: 2 },
          items: [{ title: 'Cajuela PVC 6 mm' }],
          totals: { totalUsd: 2350 }
        }
      }
    }
  ];
}

test('detects one natural command to send both split quotations', () => {
  const { service, cleanup } = loadService();
  try {
    assert.deepEqual(
      service.parseQuotationSplitSend('ELAN envíale las dos cotizaciones al cliente POLARIZADO'),
      {
        type: service.BUSINESS_COMMANDS.QUOTATION_SPLIT_SEND,
        expectedCount: 2,
        customerReference: 'polarizado'
      }
    );

    assert.equal(
      service.detectOwnerBusinessCommand('ELAN envíale las dos cotizaciones al cliente POLARIZADO')?.type,
      service.BUSINESS_COMMANDS.QUOTATION_SPLIT_SEND
    );
  } finally {
    cleanup();
  }
});

test('prepares exactly two official confirmation operations for the active split group', async () => {
  const group = '31f90973-56c6-42e6-943c-b70cad4ea343';
  const { service, pendingCalls, cleanup } = loadService({
    rows: splitRows(),
    context: { lastEntityType: 'quotation_split', lastEntityId: group }
  });

  try {
    const command = service.detectOwnerBusinessCommand(
      'ELAN envíale las dos cotizaciones al cliente POLARIZADO'
    );
    const result = await service.executeOwnerBusinessCommand(command);

    assert.equal(result.handled, true);
    assert.equal(result.result.status, 'prepared');
    assert.equal(result.result.prepared.length, 2);
    assert.equal(pendingCalls.length, 2);

    assert.deepEqual(
      pendingCalls.map(call => call.capability),
      ['business.quotation.send-whatsapp', 'business.quotation.send-whatsapp']
    );
    assert.deepEqual(
      pendingCalls.map(call => call.parameters.projectId),
      ['child-project-1', 'child-project-2']
    );
    assert.deepEqual(
      pendingCalls.map(call => call.parameters.quotationId),
      ['child-quotation-1', 'child-quotation-2']
    );

    assert.match(result.outputText, /COT-SPLIT-1/);
    assert.match(result.outputText, /COT-SPLIT-2/);
    assert.match(result.outputText, /CONFIRMAR OPS-TEST-1/);
    assert.match(result.outputText, /CONFIRMAR OPS-TEST-2/);
  } finally {
    cleanup();
  }
});

test('does not prepare sends if one split alternative is already sent', async () => {
  const group = '31f90973-56c6-42e6-943c-b70cad4ea343';
  const { service, pendingCalls, cleanup } = loadService({
    rows: splitRows({ secondStatus: 'sent' }),
    context: { lastEntityType: 'quotation_split', lastEntityId: group }
  });

  try {
    const result = await service.executeOwnerBusinessCommand({
      type: service.BUSINESS_COMMANDS.QUOTATION_SPLIT_SEND,
      expectedCount: 2,
      customerReference: 'polarizado'
    });

    assert.equal(result.result.status, 'split_not_draft');
    assert.equal(pendingCalls.length, 0);
    assert.match(result.outputText, /ya no están en borrador/i);
  } finally {
    cleanup();
  }
});

test('does not mix quotations from different split groups', async () => {
  const group = '31f90973-56c6-42e6-943c-b70cad4ea343';
  const { service, pendingCalls, cleanup } = loadService({
    rows: splitRows({ secondGroup: 'other-group' }),
    context: { lastEntityType: 'quotation_split', lastEntityId: group }
  });

  try {
    const result = await service.executeOwnerBusinessCommand({
      type: service.BUSINESS_COMMANDS.QUOTATION_SPLIT_SEND,
      expectedCount: 2,
      customerReference: 'polarizado'
    });

    assert.equal(result.result.status, 'split_count_mismatch');
    assert.equal(pendingCalls.length, 0);
  } finally {
    cleanup();
  }
});

test('can recover the unique draft split group by customer when conversational split context is gone', async () => {
  const { service, pendingCalls, cleanup } = loadService({
    rows: splitRows(),
    context: {}
  });

  try {
    const result = await service.executeOwnerBusinessCommand({
      type: service.BUSINESS_COMMANDS.QUOTATION_SPLIT_SEND,
      expectedCount: 2,
      customerReference: 'polarizado'
    });

    assert.equal(result.result.status, 'prepared');
    assert.equal(pendingCalls.length, 2);
  } finally {
    cleanup();
  }
});
