import test from 'node:test';
import assert from 'node:assert/strict';
import { QuoteProjectService } from '../services/quoteCore/quoteProjectService.js';

function createMemoryAdapter() {
  const state = { quotations: [], projects: [], followUps: [], events: [] };
  return {
    state,
    async createQuotation(row) {
      const record = { ...row, id: row.id || `quote-${state.quotations.length + 1}` };
      state.quotations.push(record);
      return record;
    },
    async createProject(row) {
      const record = { ...row, id: row.id || `project-${state.projects.length + 1}` };
      state.projects.push(record);
      return record;
    },
    async updateQuotation(id, patch) {
      const record = state.quotations.find((item) => item.id === id);
      Object.assign(record, patch);
      return record;
    },
    async updateProject(id, patch) {
      const record = state.projects.find((item) => item.id === id);
      Object.assign(record, patch);
      return record;
    },
    async upsertFollowUp(row) {
      const index = state.followUps.findIndex((item) => item.quotation_id === row.quotation_id);
      if (index >= 0) state.followUps[index] = { ...state.followUps[index], ...row };
      else state.followUps.push(row);
      return row;
    },
    async appendEvent(row) {
      const record = { ...row, id: `event-${state.events.length + 1}` };
      state.events.push(record);
      return record;
    },
    async listQuotations(filters = {}) {
      return state.quotations.filter((item) => !filters.executiveId || item.executive_id === filters.executiveId);
    },
    async listProjects(filters = {}) {
      return state.projects.filter((item) => !filters.executiveId || item.executive_id === filters.executiveId);
    }
  };
}

const validInput = {
  quotation: {
    platformId: 'ELANVISUAL',
    source: { type: 'manual', designMode: 'optional' }
  },
  relations: {
    customerId: 'crm-customer-1',
    executiveId: 'exec-1'
  },
  customerSnapshot: { name: 'Valentina' },
  executiveSnapshot: { name: 'Ejecutivo Uno' },
  items: [
    { title: 'Rótulo luminoso', quantity: 1, unitPriceUsd: 500 }
  ],
  pricing: {
    exchangeRate: 36.8,
    totalUsd: 500,
    payableTotalNio: 18400
  },
  paymentTerms: {
    type: '60_40',
    installments: [
      { label: 'Anticipo', percentage: 60 },
      { label: 'Contra entrega', percentage: 40 }
    ]
  }
};

test('crea cotización, proyecto, seguimiento y evento inicial', async () => {
  const adapter = createMemoryAdapter();
  const service = new QuoteProjectService({ adapter });

  const result = await service.create(validInput, {
    userId: 'user-1', role: 'executive', executiveId: 'exec-1'
  });

  assert.equal(result.quotation.customer_id, 'crm-customer-1');
  assert.equal(result.project.quotation_id, result.quotation.id);
  assert.equal(adapter.state.followUps.length, 1);
  assert.equal(adapter.state.events[0].event_type, 'quotation.created');
});

test('rechaza cuotas que no suman cien por ciento', async () => {
  const adapter = createMemoryAdapter();
  const service = new QuoteProjectService({ adapter });

  await assert.rejects(
    () => service.create({
      ...validInput,
      paymentTerms: {
        type: 'custom',
        installments: [
          { label: 'Inicial', percentage: 50 },
          { label: 'Final', percentage: 30 }
        ]
      }
    }, { userId: 'user-1' }),
    (error) => error.code === 'QUOTE_VALIDATION_ERROR'
  );
});

test('confirma anticipo y activa el proyecto', async () => {
  const adapter = createMemoryAdapter();
  const service = new QuoteProjectService({ adapter });
  const created = await service.create(validInput, {
    userId: 'admin-1', role: 'admin', executiveId: 'exec-1'
  });

  const result = await service.confirmDeposit({
    quotationId: created.quotation.id,
    projectId: created.project.id,
    actor: { userId: 'admin-1', role: 'admin' },
    paymentReference: 'REC-001'
  });

  assert.equal(result.quotation.status, 'deposit_confirmed');
  assert.equal(result.project.status, 'active');
  assert.equal(result.project.current_stage, 'work_order_ready');
  assert.deepEqual(
    adapter.state.events.slice(-2).map((event) => event.event_type),
    ['quotation.deposit_confirmed', 'project.activated']
  );
});

test('limita las consultas del ejecutivo a su propio executiveId', async () => {
  const adapter = createMemoryAdapter();
  const service = new QuoteProjectService({ adapter });
  await service.create(validInput, { userId: 'user-1', role: 'executive', executiveId: 'exec-1' });
  await service.create({
    ...validInput,
    relations: { ...validInput.relations, executiveId: 'exec-2' }
  }, { userId: 'user-2', role: 'executive', executiveId: 'exec-2' });

  const rows = await service.listForActor({}, { role: 'executive', executiveId: 'exec-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].executive_id, 'exec-1');
});
