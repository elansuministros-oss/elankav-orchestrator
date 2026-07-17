import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectQueryService, summarizeOperationalQuery } from '../services/quoteCore/projectQueryService.js';

const now = new Date('2026-07-20T12:00:00.000Z');

function buildAdapter() {
  const quotations = [
    {
      id: 'q-1', quotation_number: 'COT-001', customer_id: 'c-1', executive_id: 'e-1',
      status: 'sent', created_at: '2026-07-10T12:00:00.000Z', sent_at: '2026-07-10T12:00:00.000Z',
      customer_snapshot: { name: 'Valentina Ruiz', companyName: 'Valentina Studio' }, total_usd: 500,
      payable_total_nio: 18400
    },
    {
      id: 'q-2', quotation_number: 'COT-002', customer_id: 'c-2', executive_id: 'e-1',
      status: 'deposit_confirmed', created_at: '2026-07-18T12:00:00.000Z',
      customer_snapshot: { name: 'Carlos López', companyName: 'Comercial López' }, total_usd: 900,
      payable_total_nio: 33120
    }
  ];

  const projects = [
    {
      id: 'p-1', project_number: 'PROJ-001', quotation_id: 'q-1', customer_id: 'c-1', executive_id: 'e-1',
      status: 'production', current_stage: 'fabricacion', priority: 'normal', expected_delivery_at: '2026-07-25',
      customer_snapshot: { name: 'Valentina Ruiz', companyName: 'Valentina Studio' }, title: 'Rótulo luminoso'
    },
    {
      id: 'p-2', project_number: 'PROJ-002', quotation_id: 'q-2', customer_id: 'c-2', executive_id: 'e-1',
      status: 'work_order_ready', current_stage: 'work_order_ready', priority: 'high', expected_delivery_at: '2026-07-28',
      customer_snapshot: { name: 'Carlos López', companyName: 'Comercial López' }, title: 'Letras 3D'
    }
  ];

  return {
    async listQuotations({ executiveId, status } = {}) {
      return quotations.filter((row) => (!executiveId || row.executive_id === executiveId) && (!status || row.status === status));
    },
    async listProjects({ executiveId, status, customerId } = {}) {
      return projects.filter((row) =>
        (!executiveId || row.executive_id === executiveId)
        && (!status || row.status === status)
        && (!customerId || row.customer_id === customerId)
      );
    },
    async getFollowUpByQuotationId(quotationId) {
      if (quotationId !== 'q-1') return null;
      return { quotation_id: 'q-1', last_follow_up_at: '2026-07-12T12:00:00.000Z', next_follow_up_at: null, next_action: '' };
    },
    async listWorkOrders({ projectId }) {
      return projectId === 'p-2' ? [] : [{ id: 'wo-1' }];
    },
    async listPurchaseOrders({ projectId }) {
      return projectId === 'p-1'
        ? [{ id: 'po-1', purchase_order_number: 'OC-001', supplier_id: 's-1', status: 'ordered', blocks_production: true }]
        : [];
    }
  };
}

function buildQuotationDetailAdapter() {
  const quotation = {
    id: '11111111-1111-4111-8111-111111111111',
    quotation_number: 'COT-20260717-00005',
    platform_id: 'ELANVISUAL',
    source_type: 'manual',
    source_id: 'manual-1',
    design_mode: 'optional',
    customer_id: 'customer-1',
    executive_id: 'EXEC-ERICK-CANO-001',
    status: 'draft',
    issued_at: '2026-07-17T10:00:00.000Z',
    valid_until: '2026-08-01T10:00:00.000Z',
    customer_snapshot: {
      name: 'Karen Vega',
      companyName: 'VICKAND Coffee',
      phone: '+505 7882 8089'
    },
    executive_snapshot: {
      executiveId: 'EXEC-ERICK-CANO-001',
      name: 'Erick Cano'
    },
    items: [{
      title: 'Rotulo comercial',
      quantity: 1,
      unit: 'unidad',
      unitPriceUsd: 290,
      subtotalUsd: 290,
      images: []
    }],
    pricing: {
      subtotalUsd: 290,
      discountUsd: 0,
      taxRate: 0,
      taxUsd: 0,
      totalUsd: 290,
      exchangeRate: 36.6243,
      payableTotalNio: 10621.05
    },
    payment_terms: { type: '60_40', installments: [] },
    relations: {
      customerId: 'customer-1',
      executiveId: 'EXEC-ERICK-CANO-001'
    },
    total_usd: 290,
    payable_total_nio: 10621.05,
    created_at: '2026-07-17T10:00:00.000Z',
    updated_at: '2026-07-17T10:00:00.000Z'
  };
  const project = {
    id: '22222222-2222-4222-8222-222222222222',
    project_number: 'PRJ-20260717-00005',
    quotation_id: quotation.id,
    platform_id: 'ELANVISUAL',
    customer_id: 'customer-1',
    executive_id: 'EXEC-ERICK-CANO-001',
    title: 'Rotulo comercial',
    status: 'pending_activation',
    current_stage: 'quotation',
    priority: 'normal',
    expected_delivery_at: null,
    created_at: '2026-07-17T10:00:00.000Z',
    updated_at: '2026-07-17T10:00:00.000Z'
  };

  const calls = [];
  return {
    calls,
    async getQuotationByNumber(quotationNumber) {
      calls.push(['getQuotationByNumber', quotationNumber]);
      return quotationNumber === quotation.quotation_number ? quotation : null;
    },
    async getProjectByQuotationId(quotationId) {
      calls.push(['getProjectByQuotationId', quotationId]);
      return quotationId === quotation.id ? project : null;
    },
    async getProjectById(projectId) {
      calls.push(['getProjectById', projectId]);
      return projectId === project.id ? project : null;
    },
    async getQuotationById(quotationId) {
      calls.push(['getQuotationById', quotationId]);
      return quotationId === quotation.id ? quotation : null;
    }
  };
}

test('consulta trabajos en producción por cliente', async () => {
  const service = new ProjectQueryService({ adapter: buildAdapter(), now: () => now });
  const rows = await service.getProductionProjects({ customerQuery: 'Valentina' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].projectNumber, 'PROJ-001');
  assert.equal(rows[0].title, 'Rótulo luminoso');
});

test('detecta cotizaciones activas sin seguimiento suficiente', async () => {
  const service = new ProjectQueryService({ adapter: buildAdapter(), now: () => now });
  const rows = await service.getQuotationsWithoutFollowUp({ staleDays: 3 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quotationNumber, 'COT-001');
  assert.equal(rows[0].reason, 'next_action_missing');
  assert.equal(rows[0].staleForDays, 8);
});

test('detecta anticipo confirmado sin orden de trabajo', async () => {
  const service = new ProjectQueryService({ adapter: buildAdapter(), now: () => now });
  const rows = await service.getDepositsWithoutWorkOrder({ executiveId: 'e-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quotationNumber, 'COT-002');
  assert.equal(rows[0].project.projectNumber, 'PROJ-002');
});

test('detecta proyectos bloqueados por compras', async () => {
  const service = new ProjectQueryService({ adapter: buildAdapter(), now: () => now });
  const rows = await service.getProjectsBlockedByPurchases({ executiveId: 'e-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].projectNumber, 'PROJ-001');
  assert.equal(rows[0].blockingPurchaseOrders[0].purchaseOrderNumber, 'OC-001');
});

test('resume resultados operativos sin exponer datos internos', () => {
  const summary = summarizeOperationalQuery('production_by_customer', [{ projectId: 'p-1' }]);
  assert.deepEqual(summary, {
    type: 'production_by_customer',
    count: 1,
    hasResults: true,
    rows: [{ projectId: 'p-1' }]
  });
});

test('resuelve detalle oficial por numero comercial de cotizacion', async () => {
  const adapter = buildQuotationDetailAdapter();
  const service = new ProjectQueryService({ adapter, now: () => now });
  const detail = await service.getQuotationDetailByReference('COT-20260717-00005', { platformId: 'ELANVISUAL' });

  assert.equal(detail.projectId, '22222222-2222-4222-8222-222222222222');
  assert.equal(detail.quotationId, '11111111-1111-4111-8111-111111111111');
  assert.equal(detail.quotationNumber, 'COT-20260717-00005');
  assert.equal(detail.quotation_document.publicDocument.quotationNumber, 'COT-20260717-00005');
  assert.equal(detail.quotation_document.publicDocument.customer.name, 'Karen Vega');
  assert.equal(detail.quotation_document.publicDocument.totals.total, 290);
  assert.deepEqual(adapter.calls.slice(0, 2), [
    ['getQuotationByNumber', 'COT-20260717-00005'],
    ['getProjectByQuotationId', '11111111-1111-4111-8111-111111111111']
  ]);
});

test('resuelve detalle oficial por projectId UUID', async () => {
  const adapter = buildQuotationDetailAdapter();
  const service = new ProjectQueryService({ adapter, now: () => now });
  const detail = await service.getQuotationDetailByReference('22222222-2222-4222-8222-222222222222', { platformId: 'ELANVISUAL' });

  assert.equal(detail.projectId, '22222222-2222-4222-8222-222222222222');
  assert.equal(detail.quotationNumber, 'COT-20260717-00005');
  assert.equal(detail.quotation_document.publicDocument.projectId, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(adapter.calls.slice(0, 2), [
    ['getProjectById', '22222222-2222-4222-8222-222222222222'],
    ['getQuotationById', '11111111-1111-4111-8111-111111111111']
  ]);
});
