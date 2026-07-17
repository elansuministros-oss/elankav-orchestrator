const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { createPurchaseOrderContract } = require('../modules/purchase-orders/contract');
const { validatePurchaseOrderContract } = require('../modules/purchase-orders/validators');
const { mapPurchaseOrderContractToRow } = require('../modules/purchase-orders/entities');
const { PurchaseOrderService } = require('../modules/purchase-orders/services');
const { PurchaseOrderMapper } = require('../modules/purchase-orders/mappers/PurchaseOrderMapper');
const { handlePurchaseOrderApi } = require('../api/purchaseOrderApi');

function makePurchaseOrderInput(overrides = {}) {
  const { purchaseOrder, source, ...rest } = overrides;
  return {
    purchaseOrder: {
      platformId: 'ELANVISUAL',
      title: 'Compra de acrilico',
      ...(purchaseOrder || {})
    },
    source: source || { type: 'manual' },
    supplierSnapshot: { supplierId: 'supplier-1', name: 'Proveedor demo' },
    items: [{
      title: 'Acrilico 3mm',
      quantity: 2,
      unit: 'lamina'
    }],
    ...rest
  };
}

function makeReq({ url = '/api/purchase-orders', method = 'GET', body, headers = {} } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.url = url;
  req.method = method;
  req.headers = headers;
  return req;
}

function makeResponse() {
  const state = { statusCode: null, payload: null, headers: {} };
  return {
    state,
    res: {
      setHeader(name, value) { state.headers[name] = value; }
    },
    sendJson(_res, statusCode, payload) {
      state.statusCode = statusCode;
      state.payload = payload;
    }
  };
}

test('PO-01 crea PurchaseOrderContract v1 manual valido', () => {
  const contract = createPurchaseOrderContract(makePurchaseOrderInput());
  const validation = validatePurchaseOrderContract(contract);

  assert.equal(contract.contractVersion, '1.0.0');
  assert.equal(contract.source.type, 'manual');
  assert.equal(contract.purchaseOrder.status, 'draft');
  assert.equal(validation.ok, true);
});

test('PO-01 deja workOrder preparado pero no activo como origen', () => {
  const contract = createPurchaseOrderContract(makePurchaseOrderInput({ source: { type: 'workOrder', workOrderId: 'wo1' } }));
  const validation = validatePurchaseOrderContract(contract);

  assert.equal(contract.source.type, 'workOrder');
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /source\.type/);
});

test('PO-01 mapper futuro desde WorkOrder no esta activado', () => {
  assert.throws(
    () => PurchaseOrderMapper.fromWorkOrder({}),
    /no activado/
  );
});

test('PO-01 mapper omite purchase_order_number cuando no viene en contrato', () => {
  const contract = createPurchaseOrderContract(makePurchaseOrderInput());
  const row = mapPurchaseOrderContractToRow(contract);

  assert.equal(Object.hasOwn(row, 'purchase_order_number'), false);
  assert.equal(row.supplier_id, 'supplier-1');
});

test('PO-01 servicio crea documento, aprueba y recibe', async () => {
  let row = null;
  const repository = {
    async create(inputRow) {
      row = {
        id: 'po-1',
        purchase_order_number: 'PO-2026-000001',
        created_at: '2026-07-17T00:00:00.000Z',
        updated_at: '2026-07-17T00:00:00.000Z',
        ...inputRow
      };
      return row;
    },
    async getById() {
      return row;
    },
    async update(_id, patch) {
      row = { ...row, ...patch };
      return row;
    },
    async receive(_id, receipt) {
      row = { ...row, ...receipt.patch };
      return row;
    }
  };
  const service = new PurchaseOrderService({ repository });
  const created = await service.create(makePurchaseOrderInput({ purchaseOrder: { status: 'pending_approval' } }), { userId: 'user-1' });

  assert.equal(created.purchaseOrder.purchaseOrderNumber, 'PO-2026-000001');
  assert.equal(created.document.documentType, 'purchase_order');

  const approved = await service.approve('po-1', { userId: 'user-1' });
  assert.equal(approved.status, 'approved');

  await service.changeStatus('po-1', 'ordered', { userId: 'user-1' });
  const received = await service.receive('po-1', { items: [{ itemId: 'po-item-1', quantity: 2 }] }, { userId: 'user-1' });
  assert.equal(received.status, 'received');
  assert.equal(received.receipts.length, 1);
});

test('PO-01 API expone POST, approve y receive', async () => {
  const calls = [];
  const service = {
    async create(input, actor) {
      calls.push(['create', input.purchaseOrder.title, actor.platformId]);
      return {
        purchaseOrder: { id: 'po-1', purchaseOrderNumber: 'PO-1', title: input.purchaseOrder.title },
        document: { documentType: 'purchase_order' }
      };
    },
    async approve(id) {
      calls.push(['approve', id]);
      return { id, status: 'approved' };
    },
    async receive(id, input) {
      calls.push(['receive', id, input.items.length]);
      return { id, status: 'received' };
    }
  };

  const created = makeResponse();
  await handlePurchaseOrderApi({
    req: makeReq({
      method: 'POST',
      body: makePurchaseOrderInput(),
      headers: { 'x-elankav-platform': 'ELANVISUAL' }
    }),
    res: created.res,
    sendJson: created.sendJson,
    service
  });
  assert.equal(created.state.statusCode, 201);
  assert.equal(created.state.payload.document.documentType, 'purchase_order');

  const approved = makeResponse();
  await handlePurchaseOrderApi({
    req: makeReq({ method: 'POST', url: '/api/purchase-orders/po-1/approve', body: {} }),
    res: approved.res,
    sendJson: approved.sendJson,
    service
  });
  assert.equal(approved.state.statusCode, 200);

  const received = makeResponse();
  await handlePurchaseOrderApi({
    req: makeReq({ method: 'POST', url: '/api/purchase-orders/po-1/receive', body: { items: [{ itemId: 'po-item-1' }] } }),
    res: received.res,
    sendJson: received.sendJson,
    service
  });
  assert.equal(received.state.statusCode, 200);
  assert.deepEqual(calls.map((call) => call[0]), ['create', 'approve', 'receive']);
});
