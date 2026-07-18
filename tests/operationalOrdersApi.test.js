const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  handleVqsOperationalOrdersApi,
  matchRoute
} = require('../api/vqsOperationalOrdersApi');

function makeReq({ url, method = 'GET', body, headers = {} }) {
  const req = new EventEmitter();
  req.url = url;
  req.method = method;
  req.headers = headers;
  req.destroy = () => {};
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function makeResponse() {
  const state = { statusCode: null, payload: null, headers: {} };
  return {
    state,
    res: { setHeader(name, value) { state.headers[name] = value; } },
    sendJson(_res, statusCode, payload) { state.statusCode = statusCode; state.payload = payload; }
  };
}

test('reconoce rutas OT y OC sin capturar otras rutas', () => {
  assert.deepEqual(matchRoute('/api/vqs/projects/project-1/work-orders'), {
    projectId: 'project-1', resource: 'work-orders', itemId: ''
  });
  assert.deepEqual(matchRoute('/api/vqs/projects/project-1/purchase-orders/po-1'), {
    projectId: 'project-1', resource: 'purchase-orders', itemId: 'po-1'
  });
  assert.equal(matchRoute('/api/vqs/projects/project-1'), null);
});

test('POST crea OT mediante el service autorizado', async () => {
  const response = makeResponse();
  let received;
  const ordersService = {
    async createWorkOrder(projectId, input, actor) {
      received = { projectId, input, actor };
      return { id: 'wo-1', workOrderNumber: 'OT-2026-000001', projectId };
    }
  };
  const handled = await handleVqsOperationalOrdersApi({
    req: makeReq({
      url: '/api/vqs/projects/project-1/work-orders',
      method: 'POST',
      body: { quotationId: 'quotation-1' },
      headers: { 'x-elankav-platform': 'ELANVISUAL', 'x-elankav-role': 'ventas' }
    }),
    res: response.res,
    sendJson: response.sendJson,
    ordersService
  });

  assert.equal(handled, true);
  assert.equal(response.state.statusCode, 201);
  assert.equal(response.state.payload.data.workOrderNumber, 'OT-2026-000001');
  assert.equal(received.projectId, 'project-1');
  assert.equal(received.input.quotationId, 'quotation-1');
  assert.equal(received.actor.role, 'ventas');
});

test('POST crea OC vinculada al proveedor', async () => {
  const response = makeResponse();
  let received;
  const ordersService = {
    async createPurchaseOrder(projectId, input) {
      received = { projectId, input };
      return { id: 'po-1', purchaseOrderNumber: 'OC-2026-000001', supplierId: input.supplierId };
    }
  };
  await handleVqsOperationalOrdersApi({
    req: makeReq({
      url: '/api/vqs/projects/project-1/purchase-orders',
      method: 'POST',
      body: { supplierId: 'supplier-1' }
    }),
    res: response.res,
    sendJson: response.sendJson,
    ordersService
  });

  assert.equal(response.state.statusCode, 201);
  assert.equal(response.state.payload.data.purchaseOrderNumber, 'OC-2026-000001');
  assert.equal(received.input.supplierId, 'supplier-1');
});

test('expone 422 para lineage inválido sin detalles internos', async () => {
  const response = makeResponse();
  const ordersService = {
    async createWorkOrder() {
      const error = new Error('La cotización no corresponde al proyecto');
      error.code = 'WORK_ORDER_LINEAGE_INVALID';
      throw error;
    }
  };
  await handleVqsOperationalOrdersApi({
    req: makeReq({ url: '/api/vqs/projects/project-1/work-orders', method: 'POST', body: {} }),
    res: response.res,
    sendJson: response.sendJson,
    ordersService
  });

  assert.equal(response.state.statusCode, 422);
  assert.equal(response.state.payload.code, 'WORK_ORDER_LINEAGE_INVALID');
});
