'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createPendingOperation,
  loadPendingOperation,
  markOperationCompleted,
  markOperationRunning
} = require('../services/ownerOpsConfirmationService');
const {
  detectOwnerCommand,
  OWNER_COMMANDS
} = require('../services/ownerCommandService');

let testDir;

test.beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'owner-ops-'));
  process.env.OWNER_OPS_STORE_PATH = path.join(testDir, 'operations.json');
});

test.afterEach(async () => {
  delete process.env.OWNER_OPS_STORE_PATH;
  if (testDir) await fs.rm(testDir, { recursive: true, force: true });
});

test('restart request is prepared, never executed directly by routing', () => {
  const command = detectOwnerCommand('ELAN reinicia CONNECT');
  assert.equal(command.type, OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE);
  assert.equal(command.capability, 'service.restart');
  assert.equal(command.target, 'connect');
});

test('confirmation requires explicit OPS id', () => {
  assert.equal(detectOwnerCommand('confirmar'), null);
  const command = detectOwnerCommand('CONFIRMAR OPS-1234567890-ABC123');
  assert.equal(command.type, OWNER_COMMANDS.OWNER_OPS_CONFIRM);
  assert.equal(command.operationId, 'OPS-1234567890-ABC123');
});

test('pending operation persists locally and can transition to completed', async () => {
  const pending = await createPendingOperation({ capability: 'service.restart', target: 'connect', summary: 'Reiniciar CONNECT', impact: 'Interrupción breve', ttlMs: 60_000 });
  assert.match(pending.id, /^OPS-/);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.result.operation.state, 'awaiting_confirmation');

  const loaded = await loadPendingOperation(pending.id);
  assert.equal(loaded.operation.target, 'connect');

  const running = await markOperationRunning(pending.id);
  assert.equal(running.status, 'running');
  assert.equal(running.result.operation.state, 'confirmed');

  const completed = await markOperationCompleted(pending.id, { capability: 'service.restart', status: 'active' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.operation.state, 'completed');
  assert.equal(completed.result.operation.execution.status, 'active');
});
