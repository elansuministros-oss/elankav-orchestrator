const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { handleVqsProjectApi } = require('../api/vqsProjectApi');

function makeReq({ url = '/api/vqs/projects', method = 'POST', body } = {}) {
  const req = new EventEmitter();
  req.url = url;
  req.method = method;
  req.headers = { host: 'localhost', 'content-type': 'application/json' };
  req.destroy = () => {};
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body));
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

function validBody() {
  return {
    platform: 'ELANVISUAL',
    source: { type: 'manual', sourceId: 'manual-1' },
    customer: { customerId: 'customer-1', name: 'Cliente' },
    executive: { executiveId: 'exec-1', name: 'Valentina' },
    items: [{ title: 'Rótulo', quantity: 1, unitPriceUsd: 100, internalData: { cost: 40 } }],
    pricing: { exchangeRate: 36.6243, taxUsd: 15 },
    payments: { type: '60_40', installments: [] }
  };
}

test('VQS ignora rutas diferentes', async () => {
  const response = makeResponse();
  const handled = await handleVqsProjectApi({ req: makeReq({ url: '/api/other', body: '{}' }), res: response.res, sendJson: response.sendJson });
  assert.equal(handled, false);
  assert.equal(response.state.statusCode, null);
});

test('VQS rechaza métodos distintos de POST', async () => {
  const response = makeResponse();
  const handled = await handleVqsProjectApi({ req: makeReq({ method: 'GET' }), res: response.res, sendJson: response.sendJson });
  assert.equal(handled, true);
  assert.equal(response.state.statusCode, 405);
  assert.equal(response.state.headers.Allow, 'POST');
});

test('VQS rechaza JSON inválido', async () => {
  const response = makeResponse();
  await handleVqsProjectApi({ req: makeReq({ body: '{' }), res: response.res, sendJson: response.sendJson });
  assert.equal(response.state.statusCode, 400);
  assert.equal(response.state.payload.code, 'INVALID_JSON');
});

test('VQS rechaza contrato incompleto', async () => {
  const response = makeResponse();
  await handleVqsProjectApi({ req: makeReq({ body: '{}' }), res: response.res, sendJson: response.sendJson });
  assert.equal(response.state.statusCode, 422);
  assert.equal(response.state.payload.code, 'VQS_CONTRACT_INVALID');
});

test('VQS crea proyecto, responde 201 y no expone internalData', async () => {
  const response = makeResponse();
  let receivedInput;
  const projectService = {
    async create(input) {
      receivedInput = input;
      return {
        quotation: { id: 'quotation-id', quotation_number: 'VQS-000001' },
        project: { id: 'project-id', project_number: 'PRJ-000001', status: 'pending_activation', current_stage: 'quotation' }
      };
    }
  };
  await handleVqsProjectApi({
    req: makeReq({ body: JSON.stringify(validBody()) }),
    res: response.res,
    sendJson: response.sendJson,
    projectService
  });
  assert.equal(response.state.statusCode, 201);
  assert.deepEqual(response.state.payload, {
    success: true,
    data: {
      quotation_id: 'quotation-id',
      quotation_number: 'VQS-000001',
      project_id: 'project-id',
      project_number: 'PRJ-000001',
      status: 'pending_activation',
      stage: 'quotation'
    }
  });
  assert.equal(receivedInput.items[0].internalData.cost, 40);
  assert.equal(JSON.stringify(response.state.payload).includes('internalData'), false);
});
