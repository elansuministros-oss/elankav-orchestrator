const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { createWorkOrderContract } = require('../modules/work-orders/contract');
const { validateWorkOrderContract } = require('../modules/work-orders/validators');
const { mapWorkOrderContractToRow } = require('../modules/work-orders/entities');
const { WorkOrderService } = require('../modules/work-orders/services');
const { WorkOrderMapper } = require('../modules/work-orders/mappers/WorkOrderMapper');
const { handleWorkOrderApi } = require('../api/workOrderApi');

function makeWorkOrderInput(overrides = {}) {
  const { workOrder, source, ...rest } = overrides;
  return {
    workOrder: {
      platformId: 'ELANVISUAL',
      title: 'Rotulo luminoso',
      ...(workOrder || {})
    },
    source: source || { type: 'manual' },
    customerSnapshot: { name: 'Cliente demo' },
    items: [{
      title: 'Estructura ACM',
      quantity: 1,
      unit: 'unidad'
    }],
    ...rest
  };
}

function makeReq({ url = '/api/work-orders', method = 'GET', body, headers = {} } = {}) {
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

test('WO-01 crea WorkOrderContract v1 manual valido', () => {
  const contract = createWorkOrderContract(makeWorkOrderInput());
  const validation = validateWorkOrderContract(contract);

  assert.equal(contract.contractVersion, '1.0.0');
  assert.equal(contract.source.type, 'manual');
  assert.equal(contract.workOrder.status, 'draft');
  assert.equal(validation.ok, true);
});

test('WO-01 deja quotation preparado pero no activo como origen', () => {
  const contract = createWorkOrderContract(makeWorkOrderInput({ source: { type: 'quotation', quotationId: 'q1' } }));
  const validation = validateWorkOrderContract(contract);

  assert.equal(contract.source.type, 'quotation');
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /source\.type/);
});

test('WO-01 mapper futuro desde Quotation no esta activado', () => {
  assert.throws(
    () => WorkOrderMapper.fromQuotation({}),
    /no activado/
  );
});

test('WO-01 mapper omite work_order_number cuando no viene en contrato', () => {
  const contract = createWorkOrderContract(makeWorkOrderInput());
  const row = mapWorkOrderContractToRow(contract);

  assert.equal(Object.hasOwn(row, 'work_order_number'), false);
});

test('WO-01 servicio crea y prepara documento con branding dinamico', async () => {
  const repository = {
    async create(row) {
      return {
        id: 'wo-1',
        work_order_number: 'WO-2026-000001',
        created_at: '2026-07-17T00:00:00.000Z',
        updated_at: '2026-07-17T00:00:00.000Z',
        ...row
      };
    }
  };
  const service = new WorkOrderService({ repository });
  const result = await service.create(makeWorkOrderInput(), { userId: 'user-1' });

  assert.equal(result.workOrder.workOrderNumber, 'WO-2026-000001');
  assert.equal(result.document.documentType, 'work_order');
  assert.equal(result.document.brandSnapshot.platformId, 'ELANVISUAL');
  assert.equal(result.document.publicDocument.internalData, undefined);
});

test('WO-01 API expone POST, GET y PATCH status', async () => {
  const calls = [];
  const service = {
    async create(input, actor) {
      calls.push(['create', input.workOrder.title, actor.platformId]);
      return {
        workOrder: { id: 'wo-1', workOrderNumber: 'WO-1', title: input.workOrder.title },
        document: { documentType: 'work_order' }
      };
    },
    async list(filters) {
      calls.push(['list', filters.status]);
      return [{ id: 'wo-1' }];
    },
    async changeStatus(id, status) {
      calls.push(['status', id, status]);
      return { id, status };
    }
  };

  const created = makeResponse();
  await handleWorkOrderApi({
    req: makeReq({
      method: 'POST',
      body: makeWorkOrderInput(),
      headers: { 'x-elankav-platform': 'ELANVISUAL' }
    }),
    res: created.res,
    sendJson: created.sendJson,
    service
  });
  assert.equal(created.state.statusCode, 201);
  assert.equal(created.state.payload.document.documentType, 'work_order');

  const listed = makeResponse();
  await handleWorkOrderApi({
    req: makeReq({ method: 'GET', url: '/api/work-orders?status=draft' }),
    res: listed.res,
    sendJson: listed.sendJson,
    service
  });
  assert.equal(listed.state.statusCode, 200);

  const status = makeResponse();
  await handleWorkOrderApi({
    req: makeReq({ method: 'PATCH', url: '/api/work-orders/wo-1/status', body: { status: 'approved' } }),
    res: status.res,
    sendJson: status.sendJson,
    service
  });
  assert.equal(status.state.statusCode, 200);
  assert.deepEqual(calls.map((call) => call[0]), ['create', 'list', 'status']);
});
