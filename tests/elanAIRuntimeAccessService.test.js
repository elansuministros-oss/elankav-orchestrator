'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  OWNER_CONNECT_READ_PERMISSIONS,
  resolveElanAIRuntimeAccess
} = require('../services/elanAIRuntimeAccessService');

test('controlled autoriza solo lecturas CONNECT para Owner Mode', () => {
  const access = resolveElanAIRuntimeAccess({
    context: { owner: { isOwner: true } },
    requestedMode: 'controlled'
  });

  assert.equal(access.runtimeMode, 'active');
  assert.equal(access.toolsAllowed, true);
  assert.equal(access.deliveryAllowed, false);
  assert.deepEqual(
    access.permissions,
    ['owner:observe', ...OWNER_CONNECT_READ_PERMISSIONS]
  );
  assert.equal(
    access.permissions.some(permission => permission.endsWith(':write')),
    false
  );
});

test('controlled degrada a shadow para una identidad cliente', () => {
  const access = resolveElanAIRuntimeAccess({
    context: { owner: { isOwner: false } },
    requestedMode: 'controlled'
  });

  assert.equal(access.runtimeMode, 'shadow');
  assert.equal(access.toolsAllowed, false);
  assert.deepEqual(access.permissions, ['customer:observe']);
});
