const test = require('node:test');
const assert = require('node:assert/strict');

const { createMasterCaseContract } = require('../modules/master-cases/contract');
const { validateMasterCaseContract } = require('../modules/master-cases/validators');
const { MasterCaseService } = require('../modules/master-cases/services');
const { DocumentLineageNumberService } = require('../modules/master-cases/numbering');
const { WorkOrderService } = require('../modules/work-orders/services');
const { PurchaseOrderService } = require('../modules/purchase-orders/services');
const { handleMasterCaseApi } = require('../api/masterCaseApi');
const { Readable } = require('node:stream');

function duplicateError() {
  const error = new Error('duplicate key value violates unique constraint');
  error.code = '23505';
  return error;
}

class MemoryMasterCaseRepository {
  constructor({ sequences = ['2026-000200', '2026-000201', '2026-000202'] } = {}) {
    this.sequences = [...sequences];
    this.rows = [];
    this.audit = [];
    this.failNextCreateWithDuplicate = false;
  }

  async create(row) {
    if (this.failNextCreateWithDuplicate) {
      this.failNextCreateWithDuplicate = false;
      throw duplicateError();
    }
    if (this.rows.some((item) => item.case_number === row.case_number)) throw duplicateError();
    const created = {
      id: row.id || `case-${this.rows.length + 1}`,
      created_at: '2026-07-17T00:00:00.000Z',
      updated_at: '2026-07-17T00:00:00.000Z',
      ...row
    };
    this.rows.push(created);
    return created;
  }

  async list() {
    return this.rows;
  }

  async getById(id) {
    return this.rows.find((row) => row.id === id) || null;
  }

  async getByCaseNumber(caseNumber) {
    return this.rows.find((row) => row.case_number === caseNumber) || null;
  }

  async getByQuotationId(quotationId) {
    return this.rows.find((row) => row.quotation_id === quotationId) || null;
  }

  async update(id, patch) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) return null;
    this.rows[index] = { ...this.rows[index], ...patch, updated_at: '2026-07-17T00:01:00.000Z' };
    return this.rows[index];
  }

  async reserveBaseSequence() {
    return this.sequences.shift() || `2026-${String(this.rows.length + 200).padStart(6, '0')}`;
  }

  async recordAudit(row) {
    this.audit.push(row);
    return { id: `audit-${this.audit.length}`, ...row };
  }
}

class MemoryOrderRepository {
  constructor({ kind }) {
    this.kind = kind;
    this.rows = [];
  }

  async create(row) {
    const numberKey = this.kind === 'work_order' ? 'work_order_number' : 'purchase_order_number';
    const created = {
      id: row.id || `${this.kind}-${this.rows.length + 1}`,
      created_at: '2026-07-17T00:00:00.000Z',
      updated_at: '2026-07-17T00:00:00.000Z',
      ...row
    };
    assert.ok(created[numberKey]);
    this.rows.push(created);
    return created;
  }

  async list() {
    return this.rows;
  }

  async getById(id) {
    return this.rows.find((row) => row.id === id) || null;
  }

  async update(id, patch) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) return null;
    this.rows[index] = { ...this.rows[index], ...patch, updated_at: '2026-07-17T00:01:00.000Z' };
    return this.rows[index];
  }

  async receive(id, receipt) {
    return this.update(id, receipt.patch || {});
  }

  async countByCaseId(caseId) {
    return this.rows.filter((row) => row.case_id === caseId).length;
  }
}

function makeQuotationRepository(rows = {}) {
  return {
    async getQuotationById(id) {
      return rows[id] || null;
    }
  };
}

function makeLineageHarness({ quotations = {}, sequences } = {}) {
  const masterCases = new MemoryMasterCaseRepository({ sequences });
  const workOrders = new MemoryOrderRepository({ kind: 'work_order' });
  const purchaseOrders = new MemoryOrderRepository({ kind: 'purchase_order' });
  const lineage = new DocumentLineageNumberService({
    masterCaseRepository: masterCases,
    workOrderRepository: workOrders,
    purchaseOrderRepository: purchaseOrders,
    quotationRepository: makeQuotationRepository(quotations),
    now: () => new Date('2026-07-17T00:00:00.000Z')
  });
  return {
    masterCases,
    workOrders,
    purchaseOrders,
    lineage,
    workOrderService: new WorkOrderService({ repository: workOrders, lineageNumberService: lineage }),
    purchaseOrderService: new PurchaseOrderService({ repository: purchaseOrders, lineageNumberService: lineage })
  };
}

function workOrderInput(overrides = {}) {
  return {
    workOrder: {
      platformId: 'ELANVISUAL',
      title: 'Produccion desde cotizacion',
      workOrderNumber: 'OT-UI-MANIPULADA',
      ...(overrides.workOrder || {})
    },
    source: overrides.source || { type: 'manual' },
    customerSnapshot: { name: 'Cliente demo' },
    items: [{ title: 'Rotulo', quantity: 1, unit: 'unidad' }],
    ...overrides.extra
  };
}

function purchaseOrderInput(overrides = {}) {
  return {
    purchaseOrder: {
      platformId: 'ELANVISUAL',
      title: 'Compra de materiales',
      purchaseOrderNumber: 'OC-UI-MANIPULADA',
      ...(overrides.purchaseOrder || {})
    },
    source: overrides.source || { type: 'manual' },
    supplierSnapshot: { supplierId: 'supplier-1', name: 'Proveedor demo' },
    items: [{ title: 'Acrilico', quantity: 2, unit: 'lamina' }],
    ...overrides.extra
  };
}

function makeReq({ url = '/api/master-cases', method = 'GET', body, headers = {} } = {}) {
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

test('WO-02 MasterCaseContract v1 valida expediente maestro', () => {
  const contract = createMasterCaseContract({
    platformId: 'ELANVISUAL',
    caseType: 'commercial',
    originType: 'quotation',
    quotationId: 'quotation-154',
    caseNumber: 'ELK-2026-000154',
    baseSequence: '2026-000154'
  });
  const validation = validateMasterCaseContract(contract);

  assert.equal(contract.contractVersion, '1.0.0');
  assert.equal(validation.ok, true);
});

test('WO-02 WO desde COT-2026-000154 genera OT-2026-000154 y rechaza numero UI', async () => {
  const { workOrderService, masterCases, workOrders } = makeLineageHarness({
    quotations: {
      'quotation-154': {
        id: 'quotation-154',
        quotation_number: 'COT-2026-000154'
      }
    }
  });

  const result = await workOrderService.create(workOrderInput({
    source: { type: 'quotation', quotationId: 'quotation-154' }
  }), { userId: 'user-1', type: 'user', platformId: 'ELANVISUAL' });

  assert.equal(result.workOrder.workOrderNumber, 'OT-2026-000154');
  assert.equal(result.workOrder.lineage.caseNumber, 'ELK-2026-000154');
  assert.equal(result.workOrder.lineage.quotationNumber, 'COT-2026-000154');
  assert.equal(workOrders.rows[0].work_order_number, 'OT-2026-000154');
  assert.equal(masterCases.rows[0].quotation_number, 'COT-2026-000154');
});

test('PO-02 dos OC en el mismo expediente usan OC-2026-000154-01 y OC-2026-000154-02', async () => {
  const { purchaseOrderService } = makeLineageHarness({
    quotations: {
      'quotation-154': {
        id: 'quotation-154',
        quotation_number: 'COT-2026-000154'
      }
    }
  });

  const first = await purchaseOrderService.create(purchaseOrderInput({
    source: { type: 'quotation', quotationId: 'quotation-154' }
  }), { userId: 'user-1', type: 'user', platformId: 'ELANVISUAL' });
  const second = await purchaseOrderService.create(purchaseOrderInput({
    purchaseOrder: { title: 'Compra adicional' },
    source: { type: 'quotation', quotationId: 'quotation-154' }
  }), { userId: 'user-1', type: 'user', platformId: 'ELANVISUAL' });

  assert.equal(first.purchaseOrder.purchaseOrderNumber, 'OC-2026-000154-01');
  assert.equal(second.purchaseOrder.purchaseOrderNumber, 'OC-2026-000154-02');
  assert.equal(first.purchaseOrder.lineage.caseId, second.purchaseOrder.lineage.caseId);
});

test('PO-02 OC manual crea expediente sin cotizacion y conserva numero sin sufijo', async () => {
  const { purchaseOrderService } = makeLineageHarness({
    sequences: ['2026-000200']
  });

  const result = await purchaseOrderService.create(purchaseOrderInput(), {
    userId: 'user-1',
    type: 'user',
    platformId: 'ELANVISUAL'
  });

  assert.equal(result.purchaseOrder.purchaseOrderNumber, 'OC-2026-000200');
  assert.equal(result.purchaseOrder.lineage.caseNumber, 'ELK-2026-000200');
  assert.equal(result.purchaseOrder.lineage.quotationId, '');
});

test('WO-02 OT manual crea expediente sin cotizacion y conserva numero sin sufijo', async () => {
  const { workOrderService } = makeLineageHarness({
    sequences: ['2026-000201']
  });

  const result = await workOrderService.create(workOrderInput(), {
    userId: 'user-1',
    type: 'user',
    platformId: 'ELANVISUAL'
  });

  assert.equal(result.workOrder.workOrderNumber, 'OT-2026-000201');
  assert.equal(result.workOrder.lineage.caseNumber, 'ELK-2026-000201');
  assert.equal(result.workOrder.lineage.quotationId, '');
});

test('WO-02 cotizacion inexistente produce error controlado', async () => {
  const { workOrderService } = makeLineageHarness();

  await assert.rejects(
    () => workOrderService.create(workOrderInput({
      source: { type: 'quotation', quotationId: 'missing-quotation' }
    }), { userId: 'user-1', type: 'user', platformId: 'ELANVISUAL' }),
    { code: 'DOCUMENT_LINEAGE_QUOTATION_NOT_FOUND' }
  );
});

test('WO-02 colision de correlativo manual reintenta con otro expediente', async () => {
  const { purchaseOrderService, masterCases } = makeLineageHarness({
    sequences: ['2026-000200', '2026-000201']
  });
  masterCases.failNextCreateWithDuplicate = true;

  const result = await purchaseOrderService.create(purchaseOrderInput(), {
    userId: 'user-1',
    type: 'user',
    platformId: 'ELANVISUAL'
  });

  assert.equal(result.purchaseOrder.purchaseOrderNumber, 'OC-2026-000201');
  assert.equal(result.purchaseOrder.lineage.caseNumber, 'ELK-2026-000201');
});

test('WO-02 persistencia incluye FK de expediente y snapshots documentales', async () => {
  const { workOrderService, workOrders } = makeLineageHarness({
    sequences: ['2026-000202']
  });

  await workOrderService.create(workOrderInput(), {
    userId: 'user-1',
    type: 'user',
    platformId: 'ELANVISUAL'
  });

  const row = workOrders.rows[0];
  assert.equal(row.case_id, 'case-1');
  assert.equal(row.case_number, 'ELK-2026-000202');
  assert.equal(row.base_sequence, '2026-000202');
  assert.equal(row.document_snapshot.publicDocument.lineage.caseId, 'case-1');
  assert.equal(row.document_snapshot.publicDocument.workOrderNumber, 'OT-2026-000202');
});

test('WO-02 auditoria registra creacion y transicion sin IP', async () => {
  const { workOrderService, masterCases } = makeLineageHarness({
    sequences: ['2026-000203']
  });

  const created = await workOrderService.create(workOrderInput(), {
    userId: 'user-1',
    type: 'user',
    platformId: 'ELANVISUAL'
  });
  await workOrderService.changeStatus(created.workOrder.id, 'approved', {
    userId: 'user-2',
    type: 'user',
    platformId: 'ELANVISUAL'
  });

  assert.equal(masterCases.audit.length, 2);
  assert.equal(masterCases.audit[0].action, 'work_order.created');
  assert.equal(masterCases.audit[1].previous_status, 'draft');
  assert.equal(masterCases.audit[1].new_status, 'approved');
  assert.equal(Object.hasOwn(masterCases.audit[1], 'ip'), false);
});

test('WO-02 MasterCase API expone POST, GET lista y GET detalle', async () => {
  const repository = new MemoryMasterCaseRepository();
  const service = new MasterCaseService({ repository });

  const created = makeResponse();
  await handleMasterCaseApi({
    req: makeReq({
      method: 'POST',
      body: {
        platformId: 'ELANVISUAL',
        caseType: 'internal_work',
        originType: 'manual_work_order',
        caseNumber: 'ELK-2026-000210',
        baseSequence: '2026-000210'
      },
      headers: { 'x-elankav-platform': 'ELANVISUAL' }
    }),
    res: created.res,
    sendJson: created.sendJson,
    service
  });
  assert.equal(created.state.statusCode, 201);

  const listed = makeResponse();
  await handleMasterCaseApi({
    req: makeReq({ method: 'GET', url: '/api/master-cases?platform=ELANVISUAL' }),
    res: listed.res,
    sendJson: listed.sendJson,
    service
  });
  assert.equal(listed.state.statusCode, 200);
  assert.equal(listed.state.payload.count, 1);

  const detail = makeResponse();
  await handleMasterCaseApi({
    req: makeReq({ method: 'GET', url: '/api/master-cases/case-1' }),
    res: detail.res,
    sendJson: detail.sendJson,
    service
  });
  assert.equal(detail.state.statusCode, 200);
  assert.equal(detail.state.payload.data.caseNumber, 'ELK-2026-000210');
});
