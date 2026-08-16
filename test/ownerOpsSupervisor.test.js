'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const tempBase = path.join(os.tmpdir(), `owner-ops-supervisor-test-${process.pid}`);
process.env.OWNER_OPS_SUPERVISOR_DIR = tempBase;

const {
  enqueueSupervisorOperation,
  readSupervisorResult
} = require('../services/ownerOpsSupervisorClient');
const {
  assertRequest,
  TARGETS
} = require('../bin/owner-ops-supervisor');

test.after(async () => {
  await fs.rm(tempBase, { recursive: true, force: true });
});

test('supervisor allowlist contains only CONNECT and Orchestrator', () => {
  assert.deepEqual(Object.keys(TARGETS).sort(), ['connect', 'orchestrator']);
  assert.equal(TARGETS.orchestrator.service, 'elankav-orchestrator.service');
});

test('supervisor rejects arbitrary shell capabilities and targets', () => {
  assert.throws(() => assertRequest({
    schemaVersion: 1,
    id: 'OPS-1234567890-ABC123',
    capability: 'shell.exec',
    target: 'orchestrator'
  }), /SUPERVISOR_CAPABILITY_DENIED/);

  assert.throws(() => assertRequest({
    schemaVersion: 1,
    id: 'OPS-1234567890-ABC123',
    capability: 'service.restart',
    target: '../../etc'
  }), /SUPERVISOR_TARGET_DENIED/);
});

test('client atomically queues a validated operation', async () => {
  const op = await enqueueSupervisorOperation({
    id: 'OPS-1234567890-ABC123',
    capability: 'service.restart',
    target: 'orchestrator',
    executeAfterMs: 500
  });

  assert.equal(op.capability, 'service.restart');
  assert.equal(op.target, 'orchestrator');
  const queued = JSON.parse(await fs.readFile(path.join(tempBase, 'requests', `${op.id}.json`), 'utf8'));
  assert.equal(queued.id, op.id);
  assert.equal(await readSupervisorResult(op.id), null);
});
