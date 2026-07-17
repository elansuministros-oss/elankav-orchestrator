'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { QuotationPdfRenderer } = require('../services/vqs/quotationPdfRenderer');
const {
  QuotationDocumentDeliveryService,
  buildObjectPath
} = require('../services/vqs/quotationDocumentDeliveryService');
const {
  ProjectDocumentOrchestrationService,
  deliveryEnabled
} = require('../services/vqs/projectDocumentOrchestrationService');

function quotationDocument() {
  return {
    schemaVersion: '1.0.0',
    platformId: 'ELANVISUAL',
    quotationNumber: 'COT-2026-000154',
    template: { templateId: 'ELANKAV-QUOTATION', templateVersion: '1.0.0' },
    publicDocument: {
      platformId: 'ELANVISUAL',
      quotationId: 'quote-1',
      quotationNumber: 'COT-2026-000154',
      issuedAt: '2026-07-17T00:00:00.000Z',
      customer: { name: 'Cliente de prueba' },
      items: [{ title: 'Rotulo', quantity: 1, subtotal: 250 }],
      totals: { subtotal: 250, tax: 37.5, total: 287.5 },
      brandSnapshot: { displayName: 'ELANVISUAL' }
    }
  };
}

test('QuotationPdfRenderer produce un PDF válido', async () => {
  const buffer = await new QuotationPdfRenderer().render(quotationDocument());
  assert.equal(Buffer.isBuffer(buffer), true);
  assert.equal(buffer.subarray(0, 8).toString('utf8'), '%PDF-1.4');
  assert.match(buffer.toString('utf8'), /COT-2026-000154/);
  assert.match(buffer.toString('utf8'), /%%EOF/);
});

test('buildObjectPath usa plataforma, id y número de cotización', () => {
  assert.equal(
    buildObjectPath({
      quotationDocument: quotationDocument(),
      quotation: { id: 'quote-1', quotation_number: 'COT-2026-000154' }
    }),
    'ELANVISUAL/quotations/quote-1/COT-2026-000154.pdf'
  );
});

test('QuotationDocumentDeliveryService sube, persiste y crea entrega', async () => {
  const calls = [];
  const storageAdapter = {
    async uploadObject(input) {
      calls.push(['upload', input]);
      return { bucket: input.bucket, path: input.path, key: `${input.bucket}/${input.path}` };
    },
    async objectExists() { return true; },
    async getObjectMetadata() { return null; },
    async createDelivery(input) {
      calls.push(['delivery', input]);
      return { ...input, signedUrl: 'https://signed.example/document.pdf' };
    },
    async deleteObject(input) { calls.push(['delete', input]); }
  };
  const repository = {
    async updateQuotation(id, patch) {
      calls.push(['persist', { id, patch }]);
      return { id, ...patch };
    }
  };
  const service = new QuotationDocumentDeliveryService({
    storageAdapter,
    pdfRenderer: new QuotationPdfRenderer(),
    quotationRepository: repository,
    bucket: 'official-documents',
    expiresIn: 7200,
    now: () => new Date('2026-07-17T20:00:00.000Z')
  });

  const result = await service.deliver({
    quotationDocument: quotationDocument(),
    quotation: {
      id: 'quote-1',
      quotation_number: 'COT-2026-000154',
      platform_id: 'ELANVISUAL',
      relations: { customerId: 'customer-1' }
    },
    project: { id: 'project-1' }
  });

  assert.equal(result.signedUrl, 'https://signed.example/document.pdf');
  assert.equal(result.expiresIn, 7200);
  assert.equal(calls[0][0], 'upload');
  assert.equal(calls[1][0], 'persist');
  assert.equal(calls[2][0], 'delivery');
  assert.equal(calls.some(([type]) => type === 'delete'), false);
  assert.equal(calls[1][1].patch.relations.customerId, 'customer-1');
  assert.equal(calls[1][1].patch.relations.documentDelivery.path, result.path);
});

test('elimina el objeto cuando falla persistencia', async () => {
  const deleted = [];
  const storageAdapter = {
    async uploadObject(input) { return { bucket: input.bucket, path: input.path }; },
    async objectExists() { return true; },
    async getObjectMetadata() { return null; },
    async createDelivery() { throw new Error('no debe ejecutarse'); },
    async deleteObject(input) { deleted.push(input); }
  };
  const service = new QuotationDocumentDeliveryService({
    storageAdapter,
    pdfRenderer: new QuotationPdfRenderer(),
    quotationRepository: {
      async updateQuotation() { throw new Error('persistencia falló'); }
    }
  });

  await assert.rejects(
    service.deliver({
      quotationDocument: quotationDocument(),
      quotation: { id: 'quote-1', quotation_number: 'COT-1' },
      project: { id: 'project-1' }
    }),
    /persistencia falló/
  );
  assert.equal(deleted.length, 1);
});

test('ProjectDocumentOrchestrationService entrega después de construir', async () => {
  const order = [];
  const service = new ProjectDocumentOrchestrationService({
    projectService: {
      async create() {
        order.push('persist');
        return { quotation: { id: 'q1' }, project: { id: 'p1' }, document: {} };
      },
      async updateProject() {}
    },
    documentBuilder: {
      build() { order.push('build'); return quotationDocument(); }
    },
    documentDeliveryService: {
      async deliver() { order.push('deliver'); return { signedUrl: 'signed' }; }
    }
  });

  const result = await service.create({}, {});
  assert.deepEqual(order, ['persist', 'build', 'deliver']);
  assert.equal(result.documentDelivery.signedUrl, 'signed');
});

test('Document Delivery permanece desactivado sin configuración explícita', () => {
  assert.equal(deliveryEnabled({}), false);
  assert.equal(deliveryEnabled({ VQS_DOCUMENT_DELIVERY_ENABLED: 'true' }), true);
});
