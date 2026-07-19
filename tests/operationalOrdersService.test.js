const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OperationalOrdersService,
  WORK_ORDER_STATES,
  PURCHASE_ORDER_STATES
} = require('../services/operations/operationalOrdersService');

const project = {
  id: 'project-1', quotation_id: 'quotation-1', project_number: 'PRY-2026-000001',
  title: 'Rótulo', customer_snapshot: { name: 'Cliente' }, platform_id: 'ELANVISUAL'
};

const existingWorkOrder = {
  id: 'wo-1', work_order_number: 'OT-2026-000001', project_id: project.id,
  quotation_id: project.quotation_id, generated_by: 'user-1', generated_by_role: 'ventas',
  status: 'pending', payload: {}, created_at: '2026-07-18T00:00:00Z', updated_at: '2026-07-18T00:00:00Z'
};

function makeAdapter({ project: projectRow, workOrders = [], purchaseOrders = [] } = {}) {
  const calls = { rpc: [], events: [], updates: [] };
  const workOrderRow = { ...existingWorkOrder, project_id: projectRow?.id, quotation_id: projectRow?.quotation_id };
  const purchaseOrderRow = {
    id: 'po-1', purchase_order_number: 'OC-2026-000001', project_id: projectRow?.id,
    supplier_id: 'supplier-1', generated_by: 'user-1', status: 'draft', blocks_production: true,
    payload: {}, created_at: '2026-07-18T00:00:00Z', updated_at: '2026-07-18T00:00:00Z'
  };

  const adapter = {
    tables: { workOrders: 'elankav_work_orders', purchaseOrders: 'elankav_purchase_orders' },
    supabase: {
      rpc(name, params) {
        calls.rpc.push({ name, params });
        return Promise.resolve({ data: [name.includes('work_order') ? workOrderRow : purchaseOrderRow], error: null });
      },
      from(table) {
        let current = table === 'elankav_work_orders' ? workOrderRow : purchaseOrderRow;
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          maybeSingle() { return Promise.resolve({ data: current, error: null }); },
          update(patch) { calls.updates.push({ table, patch }); current = { ...current, ...patch }; return chain; },
          single() { return Promise.resolve({ data: current, error: null }); }
        };
        return chain;
      }
    },
    getProjectById() { return Promise.resolve(projectRow || null); },
    listWorkOrders() { return Promise.resolve(workOrders); },
    listPurchaseOrders() { return Promise.resolve(purchaseOrders); },
    appendEvent(row) { calls.events.push(row); return Promise.resolve(row); }
  };

  return { adapter, calls };
}

function paymentAdapter({ depositCompleted = true } = {}) {
  return {
    listCustomerPayments() {
      return Promise.resolve(depositCompleted ? [{ id: 'payment-1', status: 'confirmed', deposit_completed: true }] : []);
    }
  };
}

test('crea OT con numeración transaccional y lineage correcto después del anticipo', async () => {
  const { adapter, calls } = makeAdapter({ project });
  const service = new OperationalOrdersService({ adapter, paymentAdapter: paymentAdapter() });
  const result = await service.createWorkOrder(project.id, { quotationId: project.quotation_id }, { userId: 'user-1', role: 'ventas' });
  assert.equal(result.workOrderNumber, 'OT-2026-000001');
  assert.equal(calls.rpc[0].name, 'elankav_create_work_order');
  assert.equal(calls.events[0].event_type, 'work_order.created');
});

test('rechaza OT cuando el anticipo no está completado', async () => {
  const { adapter } = makeAdapter({ project });
  const service = new OperationalOrdersService({ adapter, paymentAdapter: paymentAdapter({ depositCompleted: false }) });
  await assert.rejects(service.createWorkOrder(project.id, { quotationId: project.quotation_id }), (error) => error.code === 'DEPOSIT_REQUIRED_FOR_WORK_ORDER');
});

test('rechaza OT cuando quotation_id no corresponde al proyecto', async () => {
  const { adapter } = makeAdapter({ project });
  const service = new OperationalOrdersService({ adapter, paymentAdapter: paymentAdapter() });
  await assert.rejects(service.createWorkOrder(project.id, { quotationId: 'quotation-other' }), (error) => error.code === 'WORK_ORDER_LINEAGE_INVALID');
});

test('crea OC vinculada a proyecto, OT y proveedor', async () => {
  const { adapter, calls } = makeAdapter({ project, workOrders: [existingWorkOrder] });
  const service = new OperationalOrdersService({ adapter, paymentAdapter: paymentAdapter() });
  const result = await service.createPurchaseOrder(project.id, { supplierId: 'supplier-1' }, { userId: 'user-1' });
  assert.equal(result.purchaseOrderNumber, 'OC-2026-000001');
  assert.equal(calls.rpc[0].params.target_payload.workOrderId, 'wo-1');
});

test('rechaza OC cuando no existe OT', async () => {
  const { adapter } = makeAdapter({ project, workOrders: [] });
  const service = new OperationalOrdersService({ adapter, paymentAdapter: paymentAdapter() });
  await assert.rejects(service.createPurchaseOrder(project.id, { supplierId: 'supplier-1' }), (error) => error.code === 'WORK_ORDER_REQUIRED_FOR_PURCHASE_ORDER');
});

test('rechaza OC sin proveedor después de validar la OT', async () => {
  const { adapter } = makeAdapter({ project, workOrders: [existingWorkOrder] });
  const service = new OperationalOrdersService({ adapter, paymentAdapter: paymentAdapter() });
  await assert.rejects(service.createPurchaseOrder(project.id, {}), (error) => error.code === 'OPERATIONAL_ORDER_VALIDATION_ERROR');
});

test('valida los estados oficiales de OT y OC', async () => {
  assert.deepEqual(WORK_ORDER_STATES, ['pending', 'scheduled', 'in_progress', 'paused', 'completed', 'cancelled']);
  assert.deepEqual(PURCHASE_ORDER_STATES, ['draft', 'pending_approval', 'approved', 'ordered', 'partially_received', 'received', 'cancelled']);
  const { adapter } = makeAdapter({ project });
  const service = new OperationalOrdersService({ adapter, paymentAdapter: paymentAdapter() });
  await assert.rejects(service.updateWorkOrder(project.id, 'wo-1', { status: 'approved' }), (error) => error.code === 'WORK_ORDER_STATUS_INVALID');
  await assert.rejects(service.updatePurchaseOrder(project.id, 'po-1', { status: 'in_progress' }), (error) => error.code === 'PURCHASE_ORDER_STATUS_INVALID');
});