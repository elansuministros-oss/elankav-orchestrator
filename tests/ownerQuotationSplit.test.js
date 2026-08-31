'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function productionLikeQuotation(overrides = {}) {
  const base = {
    projectId: '407eb279-05e9-4506-b46e-5f75b951653a',
    quotationId: '31f90973-56c6-42e6-943c-b70cad4ea343',
    quotationNumber: 'COT-2026-31F90973',
    status: 'draft',
    customerId: 'c879cf69-58ad-4e42-acf7-aff54e54348f',
    executiveId: 'EXEC-ERICK-CANO-001',
    totalUsd: 4000,
    quotation_document: {
      schemaVersion: '1.3.0',
      publicDocument: {
        customer: {
          customerId: 'c879cf69-58ad-4e42-acf7-aff54e54348f',
          name: 'POLARIZADO',
          companyName: 'POLARIZADO',
          phone: '7824 4767',
          address: 'Jinotega, Nicaragua'
        },
        advisor: {
          executiveId: 'EXEC-ERICK-CANO-001',
          name: 'Erick Cano',
          role: 'Director Comercial',
          phone: '+505 8838 8940'
        },
        project: {
          title: 'Rotulación de fachada POLARIZADO – Jinotega'
        },
        items: [
          {
            itemId: 'pvc-10mm',
            title: 'PVC expandido 10 mm',
            description: 'Rótulo en PVC expandido 10 mm',
            quantity: 1,
            unit: 'unidad',
            unitPriceUsd: 1650,
            subtotalUsd: 1650,
            source: 'OWNER_EXPLICIT_PRICE'
          },
          {
            itemId: 'cajuela-pvc-6mm',
            title: 'Cajuela PVC 6 mm',
            description: 'Rótulo tipo cajuela en PVC 6 mm',
            quantity: 1,
            unit: 'unidad',
            unitPriceUsd: 2350,
            subtotalUsd: 2350,
            source: 'OWNER_EXPLICIT_PRICE'
          }
        ],
        totals: {
          subtotalUsd: 4000,
          discountUsd: 0,
          taxUsd: 0,
          totalUsd: 4000,
          exchangeRate: 36.8,
          payableTotalNio: 147200
        },
        paymentTerms: {
          type: '60_20_20',
          installments: [
            { id: 'i1', label: 'Anticipo', percentage: 60, amountUsd: 2400, amountNio: 88320 },
            { id: 'i2', label: 'Avance', percentage: 20, amountUsd: 800, amountNio: 29440 },
            { id: 'i3', label: 'Contra entrega', percentage: 20, amountUsd: 800, amountNio: 29440 }
          ]
        },
        paymentAccountsSnapshot: [{ id: 'bac-nio-01', currency: 'NIO' }],
        brandSnapshot: { name: 'ELANVISUAL' },
        template: { templateId: 'ELANKAV-QUOTATION' }
      }
    }
  };

  return {
    ...base,
    ...overrides,
    quotation_document: overrides.quotation_document || base.quotation_document
  };
}

function loadService({ current = productionLikeQuotation() } = {}) {
  const connectPath = require.resolve('../services/ownerBusinessConnectClient');
  const contextPath = require.resolve('../services/ownerBusinessContextService');
  const servicePath = require.resolve('../services/ownerQuotationService');

  const savedConnect = require.cache[connectPath];
  const savedContext = require.cache[contextPath];
  const savedService = require.cache[servicePath];

  const calls = [];
  const idempotent = new Map();

  require.cache[connectPath] = {
    id: connectPath,
    filename: connectPath,
    loaded: true,
    exports: {
      createQuotation: async (document, key) => {
        calls.push({ document, key });
        if (!idempotent.has(key)) {
          const index = idempotent.size + 1;
          const totalUsd = Number(document?.pricing?.totalUsd || 0);
          idempotent.set(key, {
            projectId: `child-project-${index}`,
            quotationId: `child-quotation-${index}`,
            quotationNumber: `COT-SPLIT-${index}`,
            publicUrl: `https://visual.elankav.com/q/SPLIT${index}`,
            totalUsd
          });
        }
        return { data: idempotent.get(key), idempotent: calls.filter(call => call.key === key).length > 1 };
      },
      getQuotation: async () => ({ data: current }),
      listLogisticsRules: async () => ({ data: [] }),
      resolveCatalogPricing: async () => ({ data: {} }),
      searchCustomers: async () => ({ data: { results: [] } }),
      updateQuotation: async () => ({ data: current })
    }
  };

  require.cache[contextPath] = {
    id: contextPath,
    filename: contextPath,
    loaded: true,
    exports: {
      readContext: async () => ({
        activeCustomerId: current.customerId,
        activeProjectId: current.projectId,
        activeQuotationId: current.quotationId,
        activeQuotationNumber: current.quotationNumber
      }),
      updateContext: async value => value
    }
  };

  delete require.cache[servicePath];
  const service = require('../services/ownerQuotationService');

  function cleanup() {
    delete require.cache[servicePath];
    if (savedService) require.cache[servicePath] = savedService;
    if (savedConnect) require.cache[connectPath] = savedConnect;
    else delete require.cache[connectPath];
    if (savedContext) require.cache[contextPath] = savedContext;
    else delete require.cache[contextPath];
  }

  return { service, calls, cleanup };
}

test('detects natural split request for the active quotation', () => {
  const { service, cleanup } = loadService();
  try {
    assert.deepEqual(
      service.parseQuotationSplitRequest('ELAN divide esta cotización en dos, una por cada ítem'),
      {
        splitActive: true,
        splitMode: 'per_item',
        requestedParts: 2,
        message: 'ELAN divide esta cotización en dos, una por cada ítem'
      }
    );

    assert.equal(
      service.parseQuotationSplitRequest('ELAN cambia el precio de esta cotización a USD 1000'),
      null
    );
  } finally {
    cleanup();
  }
});

test('splits POLARIZADO into two independent quotations without changing the source', async () => {
  const { service, calls, cleanup } = loadService();
  try {
    const result = await service.prepareAndCreateQuotation({
      splitActive: true,
      splitMode: 'per_item',
      requestedParts: 2
    });

    assert.equal(result.ready, true);
    assert.equal(result.split, true);
    assert.equal(result.sourceQuotation.quotationNumber, 'COT-2026-31F90973');
    assert.equal(result.quotations.length, 2);
    assert.equal(calls.length, 2);

    assert.equal(calls[0].document.items.length, 1);
    assert.equal(calls[0].document.items[0].title, 'PVC expandido 10 mm');
    assert.equal(calls[0].document.pricing.totalUsd, 1650);
    assert.equal(calls[0].document.pricing.payableTotalNio, 60720);
    assert.equal(calls[0].document.paymentTerms.type, '60_20_20');
    assert.deepEqual(
      calls[0].document.paymentTerms.installments.map(item => item.amountUsd),
      [990, 330, 330]
    );

    assert.equal(calls[1].document.items.length, 1);
    assert.equal(calls[1].document.items[0].title, 'Cajuela PVC 6 mm');
    assert.equal(calls[1].document.pricing.totalUsd, 2350);
    assert.equal(calls[1].document.pricing.payableTotalNio, 86480);
    assert.deepEqual(
      calls[1].document.paymentTerms.installments.map(item => item.amountUsd),
      [1410, 470, 470]
    );

    assert.equal(
      calls[0].document.relations.splitFromQuotationId,
      '31f90973-56c6-42e6-943c-b70cad4ea343'
    );
    assert.equal(
      calls[1].document.relations.splitFromProjectId,
      '407eb279-05e9-4506-b46e-5f75b951653a'
    );
    assert.equal(calls[0].document.relations.splitGroupId, calls[1].document.relations.splitGroupId);

    assert.equal(
      calls[0].key,
      'owner-split-31f90973-56c6-42e6-943c-b70cad4ea343-1-pvc-10mm'
    );
    assert.equal(
      calls[1].key,
      'owner-split-31f90973-56c6-42e6-943c-b70cad4ea343-2-cajuela-pvc-6mm'
    );

    assert.match(result.summary, /Origen conservado: COT-2026-31F90973/);
    assert.match(result.summary, /USD 1650\.00/);
    assert.match(result.summary, /USD 2350\.00/);
  } finally {
    cleanup();
  }
});

test('repeating the split uses the same idempotency keys instead of creating a new split identity', async () => {
  const { service, calls, cleanup } = loadService();
  try {
    await service.prepareAndCreateQuotation({ splitActive: true, splitMode: 'per_item', requestedParts: 2 });
    await service.prepareAndCreateQuotation({ splitActive: true, splitMode: 'per_item', requestedParts: 2 });

    assert.equal(calls.length, 4);
    assert.equal(calls[0].key, calls[2].key);
    assert.equal(calls[1].key, calls[3].key);
    assert.equal(calls[0].document.relations.splitGroupId, calls[2].document.relations.splitGroupId);
  } finally {
    cleanup();
  }
});

test('does not guess how to distribute logistics or global adjustments', async () => {
  {
    const current = productionLikeQuotation();
    current.quotation_document.publicDocument.items.push({
      itemId: 'logistics',
      title: 'Logística',
      subtotalUsd: 100,
      source: 'LOGISTICS_LIBRARY'
    });
    current.quotation_document.publicDocument.totals.totalUsd = 4100;
    current.totalUsd = 4100;

    const { service, calls, cleanup } = loadService({ current });
    try {
      const result = await service.prepareAndCreateQuotation({ splitActive: true, splitMode: 'per_item' });
      assert.equal(result.ready, false);
      assert.match(result.question, /logística separada/i);
      assert.equal(calls.length, 0);
    } finally {
      cleanup();
    }
  }

  {
    const current = productionLikeQuotation();
    current.quotation_document.publicDocument.totals.discountUsd = 100;
    current.quotation_document.publicDocument.totals.totalUsd = 3900;
    current.totalUsd = 3900;

    const { service, calls, cleanup } = loadService({ current });
    try {
      const result = await service.prepareAndCreateQuotation({ splitActive: true, splitMode: 'per_item' });
      assert.equal(result.ready, false);
      assert.match(result.question, /descuento o impuesto global/i);
      assert.equal(calls.length, 0);
    } finally {
      cleanup();
    }
  }
});
