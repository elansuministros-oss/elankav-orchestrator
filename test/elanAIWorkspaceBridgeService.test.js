'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INTENTS,
  CAPABILITY_BY_INTENT,
  normalizeRequest,
  executeElanAIWorkspaceQuery
} = require('../services/elanAIWorkspaceBridgeService');

test('VSC-002B expone únicamente intenciones read-only', () => {
  assert.deepEqual(Object.values(CAPABILITY_BY_INTENT).sort(), [
    'workspace.diff',
    'workspace.gitStatus',
    'workspace.inspect',
    'workspace.list',
    'workspace.packageManifest',
    'workspace.read',
    'workspace.search'
  ]);
  assert.equal(Object.values(CAPABILITY_BY_INTENT).some(value => /modify|publish|prepare|create/i.test(value)), false);
});

test('VSC-002B transforma intención ELAN AI al contrato oficial', () => {
  const request = normalizeRequest({
    intent: INTENTS.SEARCH,
    workspaceId: 'connect',
    query: 'createDelivery',
    paths: ['src', 'services'],
    actor: { id: 'elan-ai-runtime', type: 'service' },
    requestId: 'request-002b'
  });

  assert.equal(request.capability, 'workspace.search');
  assert.equal(request.input.workspaceId, 'connect');
  assert.equal(request.input.query, 'createDelivery');
  assert.deepEqual(request.input.paths, ['src', 'services']);
  assert.equal(request.actor.id, 'elan-ai-runtime');
  assert.equal(request.requestId, 'request-002b');
});

test('VSC-002B rechaza intenciones de escritura', () => {
  assert.throws(
    () => normalizeRequest({ intent: 'modify_file', workspaceId: 'connect' }),
    error => error.code === 'WORKSPACE_INTENT_UNSUPPORTED'
  );
});

test('VSC-002B lista workspaces mediante el contrato auditado', async () => {
  const result = await executeElanAIWorkspaceQuery({
    intent: INTENTS.LIST,
    actor: { id: 'elan-ai-test', type: 'service' },
    requestId: 'request-list-002b'
  });

  assert.equal(result.success, true);
  assert.equal(result.capability, 'workspace.list');
  assert.equal(Array.isArray(result.data.workspaces), true);
  assert.match(result.summary, /workspace\(s\) disponibles/);
  assert.ok(result.audit.eventId);
});
