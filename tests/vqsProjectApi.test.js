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

function publicProject() {
  return {
    projectId: 'project-id',
    projectNumber: 'PRJ-000001',
    quotationId: 'quotation-id',
    platformId: 'ELANVISUAL',
    customerId: 'customer-1',
    executiveId: 'exec-1',
    title: 'Rótulo',
    status: 'pending_activation',
    currentStage: 'quotation',
    priority: 'normal'
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

test('VQS consulta un proyecto por id sin datos internos', async () => {
  const response = makeResponse();
  const projectQueryService = { async getProjectById(id) { assert.equal(id, 'project-id'); return publicProject(); } };
  await handleVqsProjectApi({
    req: makeReq({ url: '/api/vqs/projects/project-id', method: 'GET' }),
    res: response.res,
    sendJson: response.sendJson,
    projectQueryService
  });
  assert.equal(response.state.statusCode, 200);
  assert.equal(response.state.payload.data.projectId, 'project-id');
  assert.equal(JSON.stringify(response.state.payload).includes('internalData'), false);
});

test('VQS devuelve 404 para proyecto inexistente', async () => {
  const response = makeResponse();
  const projectQueryService = { async getProjectById() { return null; } };
  await handleVqsProjectApi({
    req: makeReq({ url: '/api/vqs/projects/missing', method: 'GET' }),
    res: response.res,
    sendJson: response.sendJson,
    projectQueryService
  });
  assert.equal(response.state.statusCode, 404);
  assert.equal(response.state.payload.code, 'PROJECT_NOT_FOUND');
});

test('VQS consulta únicamente el estado del proyecto', async () => {
  const response = makeResponse();
  const projectQueryService = {
    async getProjectStatus(id) {
      assert.equal(id, 'project-id');
      return { projectId: id, projectNumber: 'PRJ-000001', status: 'production', stage: 'production' };
    }
  };
  await handleVqsProjectApi({
    req: makeReq({ url: '/api/vqs/projects/project-id/status', method: 'GET' }),
    res: response.res,
    sendJson: response.sendJson,
    projectQueryService
  });
  assert.equal(response.state.statusCode, 200);
  assert.deepEqual(response.state.payload.data, {
    projectId: 'project-id',
    projectNumber: 'PRJ-000001',
    status: 'production',
    stage: 'production'
  });
});

test('VQS actualiza un proyecto mediante PATCH y responde vista pública', async () => {
  const response = makeResponse();
  let patchReceived;
  const projectService = {
    async updateProject(id, patch) {
      assert.equal(id, 'project-id');
      patchReceived = patch;
      return { id };
    }
  };
  const projectQueryService = {
    async getProjectById() {
      return { ...publicProject(), title: 'Rótulo actualizado', priority: 'high' };
    }
  };
  await handleVqsProjectApi({
    req: makeReq({
      url: '/api/vqs/projects/project-id',
      method: 'PATCH',
      body: JSON.stringify({ title: 'Rótulo actualizado', priority: 'high' })
    }),
    res: response.res,
    sendJson: response.sendJson,
    projectService,
    projectQueryService
  });
  assert.equal(response.state.statusCode, 200);
  assert.equal(patchReceived.title, 'Rótulo actualizado');
  assert.equal(response.state.payload.data.priority, 'high');
});

test('VQS rechaza métodos no permitidos en detalle', async () => {
  const response = makeResponse();
  await handleVqsProjectApi({
    req: makeReq({ url: '/api/vqs/projects/project-id', method: 'DELETE' }),
    res: response.res,
    sendJson: response.sendJson
  });
  assert.equal(response.state.statusCode, 405);
  assert.equal(response.state.headers.Allow, 'GET, PATCH');
});
