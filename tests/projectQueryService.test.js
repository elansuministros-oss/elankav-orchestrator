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
