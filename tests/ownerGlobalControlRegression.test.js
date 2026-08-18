'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setJobStoreAdapterForTests } = require('../services/jobs/jobQueue');
const {
  getOwnerResponseControl,
  parseOwnerResponseControlCommand,
  setOwnerOnlyMode
} = require('../services/ownerGlobalControlService');
const { ownerOnlyDecision } = require('../services/ownerGlobalDecisionPatch');

function memoryStore() {
  const rows = new Map();
  return {
    async saveJob(job) { rows.set(job.id, structuredClone(job)); return structuredClone(job); },
    async getJob(id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
    async listJobs() { return [...rows.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(row => structuredClone(row)); },
    async markInterruptedJobs() { return []; }
  };
}

test('OWNER-ONLY-01 reconoce orden natural de silencio global', () => {
  assert.deepEqual(parseOwnerResponseControlCommand('ELAN, no respondas a nadie; solo a mí.'), { enabled: true, mode: 'owner_only' });
  assert.deepEqual(parseOwnerResponseControlCommand('ELAN volvamos a responder normalmente'), { enabled: false, mode: 'normal' });
});

test('OWNER-ONLY-01 persiste activación y desactivación', async () => {
  setJobStoreAdapterForTests(memoryStore());
  await setOwnerOnlyMode(true);
  assert.equal((await getOwnerResponseControl()).enabled, true);
  await new Promise(resolve => setTimeout(resolve, 2));
  await setOwnerOnlyMode(false);
  assert.equal((await getOwnerResponseControl()).enabled, false);
});

test('OWNER-ONLY-01 decisión bloquea welcome y respuesta externa', () => {
  const decision = ownerOnlyDecision('ELANVISUAL', { enabled: true, mode: 'owner_only' });
  assert.equal(decision.action, 'NO_REPLY');
  assert.equal(decision.reason, 'owner_only_global');
  assert.equal(decision.welcome.send, false);
  assert.equal(decision.ownerOnly, true);
});
