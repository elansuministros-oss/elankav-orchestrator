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

test('03B conserva validUntil informado en el contrato', async () => {
  const { createQuoteProject } = await import('../modules/quoteCore/quoteProjectContract.js');
  const document = createQuoteProject({
    quotation: {
      platformId: 'ELANVISUAL',
      issuedAt: '2026-08-01T10:00:00.000Z',
      validUntil: '2026-08-20T18:30:00.000Z',
      source: { type: 'manual' }
    },
    relations: { customerId: 'customer-1', executiveId: 'EXEC-ERICK-CANO-001' },
    customerSnapshot: { name: 'Cliente demo' },
    executiveSnapshot: { executiveId: 'EXEC-ERICK-CANO-001' },
    items: [{ title: 'Producto', quantity: 1, unitPriceUsd: 100 }],
    pricing: { exchangeRate: 36.5, totalUsd: 100 },
    paymentTerms: { type: '60_40', installments: [] }
  });

  const result = buildQuotationDocument({
    document,
    quotation: { id: 'q1', quotation_number: 'COT-1', created_at: '2026-08-01T00:00:00.000Z' },
    project: { id: 'p1', project_number: 'PRJ-1', status: 'pending_activation', current_stage: 'quotation' }
  });

  assert.equal(result.publicDocument.issuedAt, '2026-08-01T10:00:00.000Z');
  assert.equal(result.publicDocument.validUntil, '2026-08-20T18:30:00.000Z');
});

test('03B calcula validUntil quince dias despues de issuedAt cuando falta', async () => {
  const { createQuoteProject } = await import('../modules/quoteCore/quoteProjectContract.js');
  const document = createQuoteProject({
    quotation: {
      platformId: 'ELANVISUAL',
      issuedAt: '2026-08-01T10:00:00.000Z',
      source: { type: 'manual' }
    },
    relations: { customerId: 'customer-1', executiveId: 'EXEC-ERICK-CANO-001' },
    customerSnapshot: { name: 'Cliente demo' },
    executiveSnapshot: { executiveId: 'EXEC-ERICK-CANO-001' },
    items: [{ title: 'Producto', quantity: 1, unitPriceUsd: 100 }],
    pricing: { exchangeRate: 36.5, totalUsd: 100 },
    paymentTerms: { type: '60_40', installments: [] }
  });

  const result = buildQuotationDocument({
    document,
    quotation: { id: 'q1', quotation_number: 'COT-1', created_at: '2026-08-01T00:00:00.000Z' },
    project: { id: 'p1', project_number: 'PRJ-1', status: 'pending_activation', current_stage: 'quotation' }
  });

  assert.equal(result.publicDocument.validUntil, '2026-08-16T10:00:00.000Z');
});

test('03B no produce fechas invalidas cuando falta issuedAt', async () => {
  const { createQuoteProject } = await import('../modules/quoteCore/quoteProjectContract.js');
  const document = createQuoteProject({
    quotation: {
      platformId: 'ELANVISUAL',
      issuedAt: 'fecha-invalida',
      source: { type: 'manual' }
    },
    relations: { customerId: 'customer-1', executiveId: 'EXEC-ERICK-CANO-001' },
    customerSnapshot: { name: 'Cliente demo' },
    executiveSnapshot: { executiveId: 'EXEC-ERICK-CANO-001' },
    items: [{ title: 'Producto', quantity: 1, unitPriceUsd: 100 }],
    pricing: { exchangeRate: 36.5, totalUsd: 100 },
    paymentTerms: { type: '60_40', installments: [] }
  });

  const result = buildQuotationDocument({
    document,
    quotation: { id: 'q1', quotation_number: 'COT-1' },
    project: { id: 'p1', project_number: 'PRJ-1', status: 'pending_activation', current_stage: 'quotation' }
  });

  assert.equal(Number.isNaN(Date.parse(result.publicDocument.issuedAt)), false);
  assert.equal(Number.isNaN(Date.parse(result.publicDocument.validUntil)), false);
});

test('03B publica una sola imagen principal y prioriza generated-render', async () => {
  const { createQuoteProject } = await import('../modules/quoteCore/quoteProjectContract.js');
  const document = createQuoteProject({
    quotation: { platformId: 'ELANVISUAL', source: { type: 'manual' } },
    relations: { customerId: 'customer-1', executiveId: 'EXEC-ERICK-CANO-001' },
    customerSnapshot: { name: 'Cliente demo' },
    executiveSnapshot: { executiveId: 'EXEC-ERICK-CANO-001' },
    items: [{
      title: 'Producto',
      quantity: 1,
      unitPriceUsd: 100,
      images: [
        { kind: 'place', signedUrl: 'https://cdn.example/place.jpg', mimeType: 'image/jpeg' },
        { kind: 'reference', signedUrl: 'https://cdn.example/reference.jpg', mimeType: 'image/jpeg' },
        { kind: 'product-photo', signedUrl: 'https://cdn.example/product.jpg', mimeType: 'image/jpeg' },
        { kind: 'generated-render', signedUrl: 'https://cdn.example/render.png', mimeType: 'image/png' }
      ]
    }],
    pricing: { exchangeRate: 36.5, totalUsd: 100 },
    paymentTerms: { type: '60_40', installments: [] }
  });

  const result = buildQuotationDocument({
    document,
    quotation: { id: 'q1', quotation_number: 'COT-1' },
    project: { id: 'p1', project_number: 'PRJ-1', status: 'pending_activation', current_stage: 'quotation' }
  });

  const [item] = result.publicDocument.items;
  assert.equal(item.imageUrl, 'https://cdn.example/render.png');
  assert.deepEqual(item.images, ['https://cdn.example/render.png']);
  assert.equal(item.images.length, 1);
  assert.equal(item.images[0], item.imageUrl);
  assert.equal(JSON.stringify(result.publicDocument.items).includes('place.jpg'), false);
  assert.equal(JSON.stringify(result.publicDocument.items).includes('reference.jpg'), false);
});
