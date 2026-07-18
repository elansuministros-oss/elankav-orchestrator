'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { QuotationEditService } = require('../services/vqs/quotationEditService');

function inputFixture() {
  return {
    quotation: {
      platformId: 'ELANVISUAL',
      status: 'draft',
      source: { type: 'manual', designMode: 'optional' }
    },
    project: {
      title: 'Fachada actualizada',
      priority: 'normal',
      expectedDeliveryAt: '',
      images: []
    },
    relations: {
      customerId: 'customer-1',
      executiveId: 'EXEC-ERICK-CANO-001'
    },
    customerSnapshot: {
      name: 'Repuestos El León de Judá',
      companyName: 'Repuestos El León de Judá',
      phone: '+50584669559',
      email: '',
      address: ''
    },
    executiveSnapshot: {
      executiveId: 'EXEC-ERICK-CANO-001',
      name: 'Erick Cano'
    },
    items: [{
      itemId: 'item-1',
      title: 'Fachada',
      description: 'Descripción actualizada',
      quantity: 1,
      unit: 'unidad',
      unitPriceUsd: 2200,
      subtotalUsd: 2200,
      imageUrl: 'https://example.com/fachada.webp',
      images: ['https://example.com/fachada.webp'],
      features: []
    }],
    pricing: {
      discountUsd: 0,
      taxRate: 0,
      taxUsd: 0,
      totalUsd: 2200,
      exchangeRate: 36.8,
      payableTotalNio: 80960
    },
    paymentTerms: {
      type: '60_20_20',
      installments: [
        { label: 'Anticipo', percentage: 60 },
        { label: 'Avance', percentage: 20 },
        { label: 'Contra entrega', percentage: 20 }
      ]
    }
  };
}

function adapterFixture({ status = 'draft' } = {}) {
  const calls = [];
  const quotation = {
    id: 'quotation-12',
    quotation_number: 'COT-20260718-00012',
    platform_id: 'ELANVISUAL',
    status,
    public_token: 'public-token',
    public_url: 'https://visual.elankav.com/cotizaciones/publicas/public-token',
    issued_at: '2026-07-18T00:00:00.000Z',
    customer_id: 'customer-1',
    executive_id: 'EXEC-ERICK-CANO-001',
    created_at: '2026-07-18T00:00:00.000Z',
    relations: {
      documentDelivery: {
        bucket: 'official-documents',
        path: 'ELANVISUAL/quotations/quotation-12/COT-20260718-00012.pdf'
      }
    }
  };
  const project = {
    id: 'project-12',
    project_number: 'PRO-20260718-00012',
    quotation_id: quotation.id,
    platform_id: 'ELANVISUAL',
    status: 'pending_activation',
    current_stage: 'quotation',
    source: { type: 'manual', designMode: 'optional' },
    relations: {}
  };

  return {
    calls,
    adapter: {
      async getProjectById(id) {
        calls.push(['getProject', id]);
        return id === project.id ? { ...project } : null;
      },
      async getQuotationById(id) {
        calls.push(['getQuotation', id]);
        return id === quotation.id ? { ...quotation } : null;
      },
      async updateQuotation(id, patch) {
        calls.push(['updateQuotation', id, patch]);
        return { ...quotation, ...patch, id, quotation_number: quotation.quotation_number };
      },
      async updateProject(id, patch) {
        calls.push(['updateProject', id, patch]);
        return { ...project, ...patch, id, quotation_id: quotation.id };
      }
    }
  };
}

function documentBuilder() {
  return {
    build(result) {
      return {
        schemaVersion: '1.0.0',
        platformId: 'ELANVISUAL',
        quotationNumber: result.quotation.quotation_number,
        publicDocument: {
          quotationId: result.quotation.id,
          quotationNumber: result.quotation.quotation_number,
          customer: result.document.customerSnapshot,
          project: result.document.project,
          items: result.document.items,
          pricing: result.document.pricing,
          paymentTerms: result.document.paymentTerms
        }
      };
    }
  };
}

test('actualiza la misma cotización y conserva quotationId y número COT', async () => {
  const fixture = adapterFixture();
  const deliveries = [];
  const service = new QuotationEditService({
    adapter: fixture.adapter,
    documentBuilder: documentBuilder(),
    documentDeliveryService: {
      async deliver(input) {
        deliveries.push(input);
        return { bucket: 'official-documents', path: 'same-path.pdf', signedUrl: 'signed' };
      }
    }
  });

  const result = await service.update('project-12', inputFixture(), { userId: 'user-1' });

  assert.equal(result.quotation.id, 'quotation-12');
  assert.equal(result.quotation.quotation_number, 'COT-20260718-00012');
  assert.equal(result.project.id, 'project-12');
  assert.equal(result.quotationDocument.publicDocument.quotationId, 'quotation-12');
  assert.equal(result.quotationDocument.publicDocument.quotationNumber, 'COT-20260718-00012');
  assert.equal(fixture.calls.filter(([type]) => type === 'updateQuotation').length, 1);
  assert.equal(fixture.calls.filter(([type]) => type === 'updateProject').length, 1);
  assert.equal(deliveries.length, 1);

  const quotationPatch = fixture.calls.find(([type]) => type === 'updateQuotation')[2];
  assert.equal(quotationPatch.items[0].unitPriceUsd, 2200);
  assert.equal(quotationPatch.relations.documentDelivery.bucket, 'official-documents');
  assert.equal(quotationPatch.public_token, 'public-token');
});

test('bloquea edición cuando la cotización ya no está en draft', async () => {
  const fixture = adapterFixture({ status: 'approved' });
  const service = new QuotationEditService({
    adapter: fixture.adapter,
    documentBuilder: documentBuilder()
  });

  await assert.rejects(
    service.update('project-12', inputFixture()),
    (error) => {
      assert.equal(error.code, 'QUOTATION_EDIT_NOT_ALLOWED');
      assert.equal(error.details.status, 'approved');
      return true;
    }
  );

  assert.equal(fixture.calls.some(([type]) => type === 'updateQuotation'), false);
  assert.equal(fixture.calls.some(([type]) => type === 'updateProject'), false);
});
