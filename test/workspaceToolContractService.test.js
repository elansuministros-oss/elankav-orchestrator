'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ENABLED, invokeWorkspaceTool } = require('../services/workspaceToolContractService');

test('expone solo capacidades read-only', () => {
  assert.equal(ENABLED.has('workspace.read'), true);
  assert.equal(ENABLED.has('workspace.modify'), false);
  assert.equal(ENABLED.has('workspace.publish'), false);
});

test('rechaza capabilities mutables', async () => {
  const result = await invokeWorkspaceTool({
    requestId: 'test-request',
    actor: { id: 'elan-ai', type: 'service' },
    capability: 'workspace.modify',
    input: { workspaceId: 'connect' }
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CAPABILITY_NOT_ENABLED');
});

test('valida actor y workspaceId', async () => {
  const result = await invokeWorkspaceTool({
    capability: 'workspace.read',
    input: { path: 'package.json' }
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
});
