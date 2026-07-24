'use strict';

const {
  resolveAccessPolicy
} = require('./accessPolicyService');

const OWNER_CONNECT_READ_PERMISSIONS = Object.freeze([
  'connect:customers:read',
  'connect:suppliers:read',
  'connect:leads:read',
  'connect:opportunities:read',
  'connect:quotes:read',
  'connect:orders:read'
]);

function resolveElanAIRuntimeAccess({
  context = {},
  requestedMode = 'shadow'
} = {}) {
  const ownerMode = context.owner?.isOwner === true;
  const policy = resolveAccessPolicy({ isOwner: ownerMode });
  const controlled =
    String(requestedMode || '').trim().toLowerCase() === 'controlled';

  if (controlled && ownerMode) {
    return Object.freeze({
      policy,
      runtimeMode: 'active',
      executionMode: 'controlled',
      permissions: Object.freeze([
        'owner:observe',
        ...OWNER_CONNECT_READ_PERMISSIONS
      ]),
      toolsAllowed: true,
      deliveryAllowed: false
    });
  }

  return Object.freeze({
    policy,
    runtimeMode: 'shadow',
    executionMode: 'shadow',
    permissions: Object.freeze([
      ownerMode ? 'owner:observe' : 'customer:observe'
    ]),
    toolsAllowed: false,
    deliveryAllowed: false
  });
}

module.exports = {
  OWNER_CONNECT_READ_PERMISSIONS,
  resolveElanAIRuntimeAccess
};
