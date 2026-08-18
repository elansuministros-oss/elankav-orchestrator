'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setJobStoreAdapterForTests } = require('../services/jobs/jobQueue');
const { createDelegation } = require('../services/businessDelegationService');
const { findOpenDelegationByProviderId } = require('../services/providerDelegationInboundPatch');

function memoryStore() {
  const rows = new Map();
  return {
    async saveJob(job) { rows.set(job.id, structuredClone(job)); return structuredClone(job); },
    async getJob(id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
    async listJobs() { return [...rows.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(structuredClone); },
    async markInterruptedJobs() { return []; }
  };
}

test('PROVIDER-DELEGATION-INBOUND-01 localiza encargo oficial por providerId', async () => {
  setJobStoreAdapterForTests(memoryStore());
  await createDelegation({
    kind: 'supplier_quote',
    counterpartyName: 'SIPSA',
    phone: '88887777',
    objective: 'cotizar PVC y acrílico',
    relationshipType: 'provider',
    metadata: { providerId: 'prov-sipsa-01' }
  });
  const job = await findOpenDelegationByProviderId('prov-sipsa-01');
  assert.ok(job);
  assert.equal(job.result.delegation.counterpartyName, 'SIPSA');
  assert.equal(job.status, 'waiting_external');
});
