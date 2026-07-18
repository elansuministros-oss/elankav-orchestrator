'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QuotationDocumentDeliveryService
} = require('../services/vqs/quotationDocumentDeliveryService');
const {
  ProjectDocumentOrchestrationService
} = require('../services/vqs/projectDocumentOrchestrationService');

function documentFixture() {
  return {
    schemaVersion: '1.0.0',
    platformId: 'ELANVISUAL',
    quotationNumber: 'COT-2026-000154',
    template: {
      templateId: 'ELANKAV-QUOTATION',
      templateVersion: '1.0.0'
    },
    publicDocument: {
      platformId: 'ELANVISUAL',
      quotationId: 'quote-1',
      quotationNumber: 'COT-2026-000154',
      customer: { name: 'Cliente de prueba' },
      executive: { executiveId: 'EXEC-001' },
      items: [{ title: 'Rótulo', quantity: 1, subtotal: 250 }],
      totals: { subtotal: 250, tax: 37.5, total: 287.5 },
      brandSnapshot: { displayName: 'ELANVISUAL' }
    }
  };
}

function storageAdapter(overrides = {}) {
  return {
    async uploadObject(input) {
      return { bucket: input.bucket, path: input.path };
    },
    async objectExists() { return true; },
    async getObjectMetadata() { return null; },
    async createDelivery(input) {
      return { ...input, signedUrl: 'https://signed.example/document.pdf' };
    },
    async deleteObject() {},
    ...overrides
  };
}

function deliveryInput() {
  return {
    quotationDocument: documentFixture(),
    quotation: {
      id: 'quote-1',
      quotation_number: 'COT-2026-000154',
      platform_id: 'ELANVISUAL',
      relations: { customerId: 'customer-1' }
    },
    project: { id: 'project-1' }
  };
}

test('rechaza una salida del renderer que no sea Buffer', async () => {
  let uploaded = false;
  const service = new QuotationDocumentDeliveryService({
    storageAdapter: storageAdapter({
      async uploadObject() {
        uploaded = true;
        throw new Error('no debe ejecutarse');
      }
    }),
    pdfRenderer: { async render() { return 'no-es-buffer'; } },
    quotationRepository: { async updateQuotation() {} }
  });

  await assert.rejects(service.deliver(deliveryInput()), (error) => {
    assert.equal(error.code, 'VQS_PDF_RENDER_INVALID');
    return true;
  });
  assert.equal(uploaded, false);
});

test('si createDelivery falla conserva objeto y metadata persistida', async () => {
  const calls = [];
  const service = new QuotationDocumentDeliveryService({
    storageAdapter: storageAdapter({
      async uploadObject(input) {
        calls.push('upload');
        return { bucket: input.bucket, path: input.path };
      },
      async createDelivery() {
        calls.push('delivery');
        throw new Error('firma temporal falló');
      },
      async deleteObject() {
        calls.push('delete');
      }
    }),
    pdfRenderer: { async render() { return Buffer.from('%PDF-1.4\n%%EOF'); } },
    quotationRepository: {
      async updateQuotation() {
        calls.push('persist');
      }
    }
  });

  await assert.rejects(service.deliver(deliveryInput()), /firma temporal falló/);
  assert.deepEqual(calls, ['upload', 'persist', 'delivery']);
});

test('persiste solamente metadata estable y nunca signedUrl', async () => {
  let persistedPatch;
  const service = new QuotationDocumentDeliveryService({
    storageAdapter: storageAdapter(),
    pdfRenderer: { async render() { return Buffer.from('%PDF-1.4\n%%EOF'); } },
    quotationRepository: {
      async updateQuotation(_id, patch) {
        persistedPatch = patch;
      }
    },
    now: () => new Date('2026-07-17T20:00:00.000Z')
  });

  const result = await service.deliver(deliveryInput());
  const persisted = persistedPatch.relations.documentDelivery;

  assert.deepEqual(Object.keys(persisted).sort(), [
    'bucket',
    'contentType',
    'generatedAt',
    'path',
    'schemaVersion',
    'templateId',
    'templateVersion'
  ]);
  assert.equal('signedUrl' in persisted, false);
  assert.equal('token' in persisted, false);
  assert.equal('body' in persisted, false);
  assert.equal(typeof result.signedUrl, 'string');
});

test('feature flag deshabilitada mantiene creación y documento sin tocar Storage', async () => {
  const order = [];
  const projectService = {
    adapter: {
      async updateQuotation() {
        throw new Error('Storage no debe ejecutarse');
      }
    },
    async create() {
      order.push('create');
      return {
        quotation: { id: 'quote-1' },
        project: { id: 'project-1' },
        document: {}
      };
    },
    async updateProject() {}
  };

  const service = new ProjectDocumentOrchestrationService({
    projectService,
    documentBuilder: {
      build() {
        order.push('build');
        return documentFixture();
      }
    },
    env: {}
  });

  const result = await service.create({}, {});
  assert.deepEqual(order, ['create', 'build']);
  assert.equal(result.quotationDocument.quotationNumber, 'COT-2026-000154');
  assert.equal(result.documentDelivery, null);
});
