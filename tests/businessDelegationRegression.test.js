'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setJobStoreAdapterForTests } = require('../services/jobs/jobQueue');
const {
  classifyResponse,
  createDelegation,
  findOpenDelegationByPhone,
  handleDelegationInbound,
  sweepDelegations
} = require('../services/businessDelegationService');

function memoryStore() {
  const rows = new Map();
  return {
    async saveJob(job) { rows.set(job.id, structuredClone(job)); return structuredClone(job); },
    async getJob(id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
    async listJobs() { return [...rows.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(row => structuredClone(row)); },
    async markInterruptedJobs() { return []; }
  };
}

test('DELEGATION-01 crea encargo waiting_external sin usar pending/running', async () => {
  setJobStoreAdapterForTests(memoryStore());
  const job = await createDelegation({
    kind: 'supplier_quote',
    counterpartyName: 'SIPSA',
    phone: '88887777',
    objective: 'cotizar PVC y acrílico',
    requestedItems: '4 PVC, 2 acrílico transparente 3mm, 2 lechoso'
  });
  assert.equal(job.status, 'waiting_external');
  assert.equal(job.type, 'business_delegation');
  assert.equal(job.result.delegation.phone, '50588887777');
  const open = await findOpenDelegationByPhone('50588887777');
  assert.equal(open.counterpartyName, 'SIPSA');
});

test('DELEGATION-01 ausencia de producto escala a decision_required y avisa Owner', async () => {
  setJobStoreAdapterForTests(memoryStore());
  await createDelegation({ kind: 'supplier_quote', counterpartyName: 'SIPSA', phone: '88887777', objective: 'cotizar acrílico' });
  const notices = [];
  const handled = await handleDelegationInbound({ phone: '50588887777', text: 'No tenemos acrílico transparente de 3 mm.' }, { notify: async text => notices.push(text) });
  assert.equal(handled.classification.classification, 'blocker');
  assert.equal(handled.job.status, 'decision_required');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /requiere decisión/i);
  assert.match(notices[0], /No tenemos acrílico/i);
});

test('DELEGATION-01 precios se reconocen como actualización material', () => {
  const result = classifyResponse('PVC C$850 por lámina, entrega mañana.', { relationshipType: 'provider' });
  assert.equal(result.classification, 'material_update');
  assert.equal(result.pricing, true);
  assert.equal(result.availability, true);
});

test('DELEGATION-01 timeout notifica pero mantiene encargo abierto', async () => {
  setJobStoreAdapterForTests(memoryStore());
  const now = new Date('2026-08-18T20:00:00.000Z');
  await createDelegation({
    kind: 'provider_discovery', counterpartyName: 'Rumbitos Express', phone: '86088087',
    objective: 'conocer servicios y forma de cobro', responseTimeoutMinutes: 30,
    now: '2026-08-18T19:00:00.000Z'
  });
  const notices = [];
  const count = await sweepDelegations({ now, notify: async text => notices.push(text) });
  assert.equal(count, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Seguimiento pendiente/i);
  const open = await findOpenDelegationByPhone('86088087');
  assert.ok(open);
  assert.equal(open.reminderCount, 1);
});
