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
  TARGETS,
  porcelainEntries,
  porcelainEntry,
  porcelainPath,
  readWhatsappCoreState,
  isRecoverableDetachedConnectBranch,
  writeWhatsappCoreState,
  runWhatsappCoreContract,
  shouldRefreshSupervisorAfterRequest
} = require('../bin/owner-ops-supervisor');

test.after(async () => {
  await fs.rm(tempBase, { recursive: true, force: true });
});

test('supervisor allowlist contains only CONNECT and Orchestrator', () => {
  assert.deepEqual(Object.keys(TARGETS).sort(), ['connect', 'orchestrator']);
  assert.equal(TARGETS.orchestrator.service, 'elankav-orchestrator.service');
});

test('supervisor only auto-repairs CONNECT when HEAD is detached', () => {
  assert.equal(isRecoverableDetachedConnectBranch('connect', ''), true);
  assert.equal(isRecoverableDetachedConnectBranch('connect', 'main'), false);
  assert.equal(isRecoverableDetachedConnectBranch('connect', 'feature/test'), false);
  assert.equal(isRecoverableDetachedConnectBranch('orchestrator', ''), false);
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

test('porcelain parser preserves the fixed two-character XY status', () => {
  const file = 'data/elanvisual-commercial-catalog-2026-08-16.tsv';
  assert.deepEqual(porcelainEntry(` M ${file}`), {
    raw: ` M ${file}`,
    status: ' M',
    path: file,
    isRenameOrCopy: false
  });
  assert.equal(porcelainPath(`M  ${file}`), file);
  assert.equal(porcelainEntry(`MM ${file}`).status, 'MM');
});

test('porcelain parser keeps leading status spaces on every line and accepts CRLF', () => {
  const first = 'data/elanvisual-commercial-catalog-2026-08-16.tsv';
  const second = 'package-lock.json';
  const entries = porcelainEntries(` M ${first}\r\n M ${second}\r\n`);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].status, ' M');
  assert.equal(entries[0].path, first);
  assert.equal(entries[1].status, ' M');
  assert.equal(entries[1].path, second);
});

test('porcelain parser marks rename entries so cleanup cannot treat them as the generated catalog', () => {
  const entry = porcelainEntry('R  old.tsv -> data/elanvisual-commercial-catalog-2026-08-16.tsv');
  assert.equal(entry.status, 'R ');
  assert.equal(entry.isRenameOrCopy, true);
  assert.equal(entry.path, 'old.tsv -> data/elanvisual-commercial-catalog-2026-08-16.tsv');
});


test('supervisor embedded WhatsApp core contract passes on protected baseline', async () => {
  const result = await runWhatsappCoreContract(path.resolve(__dirname, '..'));
  assert.equal(result, 'WHATSAPP_CORE_CONTRACT_OK');
});


test('WhatsApp core last-good state is persisted atomically', async () => {
  const saved = await writeWhatsappCoreState({
    lastGoodSha: '76d30ab4886d61f3fc69aadf700de92dc0a11c5c',
    branch: 'stable/ORCHESTRATOR-WHATSAPP-CORE',
    source: 'test'
  });
  assert.equal(saved.lastGoodSha, '76d30ab4886d61f3fc69aadf700de92dc0a11c5c');
  const loaded = await readWhatsappCoreState();
  assert.equal(loaded.branch, 'stable/ORCHESTRATOR-WHATSAPP-CORE');
  assert.equal(loaded.source, 'test');
  assert.ok(loaded.updatedAt);
});


test('supervisor refresh is scheduled only after successful Orchestrator repository deploys', () => {
  assert.equal(shouldRefreshSupervisorAfterRequest({
    capability: 'repository.deploy',
    target: 'orchestrator'
  }), true);

  assert.equal(shouldRefreshSupervisorAfterRequest({
    capability: 'repository.deploy',
    target: 'connect'
  }), false);

  assert.equal(shouldRefreshSupervisorAfterRequest({
    capability: 'service.restart',
    target: 'orchestrator'
  }), false);
});
