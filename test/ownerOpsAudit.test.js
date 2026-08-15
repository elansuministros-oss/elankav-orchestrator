'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  setJobStoreAdapterForTests
} = require('../services/jobs/jobQueue');
const {
  recordAudit
} = require('../services/ownerOpsAuditService');

function createMemoryAdapter() {
  const rows = new Map();
  return {
    async saveJob(job) {
      const copy = JSON.parse(JSON.stringify(job));
      rows.set(copy.id, copy);
      return copy;
    },
    async getJob(id) {
      return rows.get(id) || null;
    },
    async listJobs() {
      return [...rows.values()];
    },
    async markInterruptedJobs() {
      return [];
    }
  };
}

test.beforeEach(() => {
  setJobStoreAdapterForTests(createMemoryAdapter());
});

test.after(() => {
  setJobStoreAdapterForTests(null);
});

test('audit record is metadata-only', async () => {
  const entry = await recordAudit({
    capability: 'service.logs',
    target: 'connect',
    success: true,
    metadata: { lines: 100 }
  });

  assert.match(entry.id, /^AUDIT-/);
  assert.equal(entry.type, 'owner_ops_audit');
  assert.equal(entry.result.audit.capability, 'service.logs');
  assert.equal(entry.result.audit.target, 'connect');
  assert.equal(entry.result.audit.outputPersisted, false);
  assert.deepEqual(entry.result.audit.metadata, { lines: 100 });
  assert.equal('stdout' in entry.result.audit, false);
  assert.equal('stderr' in entry.result.audit, false);
  assert.equal('message' in entry.result.audit, false);
});
