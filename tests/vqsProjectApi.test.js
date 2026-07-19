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

test('VQS rechaza métodos distintos de GET y POST en colección', async () => {
  const response = makeResponse();
  const handled = await handleVqsProjectApi({ req: makeReq({ method: 'PUT' }), res: response.res, sendJson: response.sendJson });
  assert.equal(handled, true);
  assert.equal(response.state.statusCode, 405);
  assert.equal(response.state.headers.Allow, 'GET, POST');
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
  assert.equal(response.state.payload.contract_version, '1.0.0');
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
    contract_version: '1.0.0',
    data: {
      quotation_id: 'quotation-id',
      quotation_number: 'VQS-000001',
      project_id: 'project-id',
      project_number: 'PRJ-000001',
      status: 'pending_activation',
      stage: 'quotation',
      quotation_document: undefined
    }
  });
  assert.equal(receivedInput.items[0].internalData.cost, 40);
  assert.equal(JSON.stringify(response.state.payload).includes('internalData'), false);
});

test('VQS lista cotizaciones con projectId persistido para abrir visor', async () => {
  const response = makeResponse();
  const calls = [];
  const projectQueryService = {
    async listQuotations(filters) {
      calls.push(filters);
      return [{
        id: 'project-id',
        projectId: 'project-id',
        projectNumber: 'PRJ-000001',
        quotationId: 'quotation-id',
        quotationNumber: 'VQS-000001',
        platformId: 'ELANVISUAL',
        status: 'draft'
      }];
    }
  };

  await handleVqsProjectApi({
    req: makeReq({ url: '/api/vqs/projects?platform=ELANVISUAL&limit=200', method: 'GET' }),
    res: response.res,
    sendJson: response.sendJson,
    projectQueryService
  });

  assert.equal(response.state.statusCode, 200);
  assert.equal(calls[0].platformId, 'ELANVISUAL');
  assert.equal(response.state.payload.data[0].projectId, 'project-id');
  assert.equal(response.state.payload.data[0].quotationId, 'quotation-id');
  assert.equal(response.state.payload.data[0].id, 'project-id');
});

test('VQS crea cotizacion y el visor recupera usando el project_id devuelto', async () => {
  const created = makeResponse();
  const projectService = {
    async create() {
      return {
        quotation: { id: 'quotation-id', quotation_number: 'VQS-000001' },
        project: { id: 'project-id', project_number: 'PRJ-000001', status: 'pending_activation', current_stage: 'quotation' },
        quotationDocument: {
          publicDocument: {
            projectId: 'project-id',
            quotationId: 'quotation-id',
            quotationNumber: 'VQS-000001',
            customer: { name: 'Cliente' },
            items: [{ title: 'Rotulo' }]
          }
        }
      };
    }
  };

  await handleVqsProjectApi({
    req: makeReq({ body: JSON.stringify(validBody()) }),
    res: created.res,
    sendJson: created.sendJson,
    projectService
  });

  const projectId = created.state.payload.data.project_id;
  const detail = makeResponse();
  const projectQueryService = {
    async getQuotationDetailByReference(reference, options) {
      assert.equal(reference, projectId);
      assert.equal(options.platformId, 'ELANVISUAL');
      return {
        projectId,
        quotationId: 'quotation-id',
        quotationNumber: 'VQS-000001',
        quotation_document: {
          publicDocument: {
            projectId,
            quotationId: 'quotation-id',
            quotationNumber: 'VQS-000001',
            customer: { name: 'Cliente' },
            items: [{ title: 'Rotulo' }]
          }
        }
      };
    }
  };

  await handleVqsProjectApi({
    req: makeReq({ url: `/api/vqs/projects/${encodeURIComponent(projectId)}?platform=ELANVISUAL`, method: 'GET' }),
    res: detail.res,
    sendJson: detail.sendJson,
    projectQueryService
  });

  assert.equal(created.state.statusCode, 201);
  assert.equal(projectId, 'project-id');
  assert.equal(detail.state.statusCode, 200);
  assert.equal(detail.state.payload.data.projectId, 'project-id');
  assert.equal(detail.state.payload.data.quotationId, 'quotation-id');
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

test('VQS resuelve detalle por numero comercial de cotizacion', async () => {
  const response = makeResponse();
  const projectQueryService = {
    async getQuotationDetailByReference(reference, options) {
      assert.equal(reference, 'COT-20260717-00005');
      assert.equal(options.platformId, 'ELANVISUAL');
      return {
        projectId: 'project-id',
        quotationId: 'quotation-id',
        quotationNumber: reference,
        quotation_document: {
          publicDocument: {
            quotationNumber: reference,
            customer: { name: 'Karen Vega' },
            items: [{ title: 'Rotulo comercial' }],
            totals: { total: 290 }
          }
        }
      };
    }
  };

  await handleVqsProjectApi({
    req: makeReq({ url: '/api/vqs/projects/COT-20260717-00005?platform=ELANVISUAL', method: 'GET' }),
    res: response.res,
    sendJson: response.sendJson,
    projectQueryService
  });

  assert.equal(response.state.statusCode, 200);
  assert.equal(response.state.payload.data.quotationNumber, 'COT-20260717-00005');
  assert.equal(response.state.payload.data.quotation_document.publicDocument.customer.name, 'Karen Vega');
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
