const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQuotationDocument } = require('../services/vqs/quotationDocumentBuilder');
const { ProjectDocumentOrchestrationService } = require('../services/vqs/projectDocumentOrchestrationService');

test('03B construye cotización pública con branding, ejecutivo y bancos', async () => {
  const { createQuoteProject } = await import('../modules/quoteCore/quoteProjectContract.js');
  const document = createQuoteProject({
    quotation: { platformId: 'ELANVISUAL', source: { type: 'api' } },
    project: { title: 'Fachada principal', images: ['https://cdn.example/project-1.jpg'] },
    relations: { customerId: 'customer-1', executiveId: 'EXEC-ERICK-CANO-001' },
    customerSnapshot: { name: 'Cliente demo' },
    executiveSnapshot: { executiveId: 'EXEC-ERICK-CANO-001' },
    items: [{
      title: 'Rótulo luminoso',
      quantity: 1,
      unitPriceUsd: 350,
      images: ['https://cdn.example/item-1.jpg'],
      internalData: { cost: 120, supplier: 'interno' }
    }],
    pricing: { exchangeRate: 36.6243, taxRate: 15, taxUsd: 52.5 },
    paymentTerms: { type: '60_40', installments: [] }
  });

  const result = buildQuotationDocument({
    document,
    quotation: { id: 'quotation-id', quotation_number: 'COT-EV-2026-0001' },
    project: {
      id: 'project-id',
      project_number: 'PRJ-2026-0001',
      title: 'Fachada principal',
      status: 'pending_activation',
      current_stage: 'quotation',
      priority: 'normal'
    }
  });

  assert.equal(result.platformId, 'ELANVISUAL');
  assert.equal(result.brandSnapshot.website, 'https://visual.elankav.com');
  assert.equal(result.executiveSnapshot.executiveId, 'EXEC-ERICK-CANO-001');
  assert.equal(result.publicDocument.paymentAccountsSnapshot.length, 4);
  assert.deepEqual(result.publicDocument.project.images, ['https://cdn.example/project-1.jpg']);
  assert.deepEqual(result.publicDocument.items[0].images, ['https://cdn.example/item-1.jpg']);
  assert.equal(result.publicDocument.items[0].internalData, undefined);
  assert.equal(JSON.stringify(result.publicDocument).includes('supplier'), false);
  assert.equal(result.publicDocument.source.type, 'api');
});

test('03B calcula USD y NIO sin exponer costos internos', async () => {
  const { createQuoteProject } = await import('../modules/quoteCore/quoteProjectContract.js');
  const document = createQuoteProject({
    quotation: { platformId: 'ELANVISUAL', source: { type: 'manual' } },
    relations: { customerId: 'customer-1', executiveId: 'EXEC-ERICK-CANO-001' },
    customerSnapshot: { name: 'Cliente demo' },
    executiveSnapshot: { executiveId: 'EXEC-ERICK-CANO-001' },
    items: [{ title: 'Producto', quantity: 2, unitPriceUsd: 100, internalData: { cost: 50 } }],
    pricing: { exchangeRate: 36.5, discountUsd: 10, taxUsd: 28.5 },
    paymentTerms: { type: '60_40', installments: [] }
  });
  const result = buildQuotationDocument({
    document,
    quotation: { id: 'q1', quotation_number: 'COT-1' },
    project: { id: 'p1', project_number: 'PRJ-1', status: 'pending_activation', current_stage: 'quotation' }
  });
  assert.equal(result.publicDocument.totals.subtotal, 200);
  assert.equal(result.publicDocument.totals.total, 218.5);
  assert.equal(result.publicDocument.totals.payableTotalNio, 7975.25);
  assert.equal(JSON.stringify(result.publicDocument).includes('internalData'), false);
});

test('03B persiste primero y construye el documento después', async () => {
  const sequence = [];
  const projectService = {
    async create() {
      sequence.push('persist');
      return {
        quotation: { id: 'q1', quotation_number: 'COT-1' },
        project: { id: 'p1', project_number: 'PRJ-1' },
        document: { quotation: { platformId: 'ELANVISUAL' } }
      };
    },
    async updateProject() { return null; }
  };
  const documentBuilder = {
    build(result) {
      sequence.push('document');
      assert.equal(result.quotation.id, 'q1');
      return { publicDocument: { quotationNumber: 'COT-1' } };
    }
  };
  const service = new ProjectDocumentOrchestrationService({ projectService, documentBuilder });
  const result = await service.create({}, {});
  assert.deepEqual(sequence, ['persist', 'document']);
  assert.equal(result.quotationDocument.publicDocument.quotationNumber, 'COT-1');
});
