'use strict';

const OWNER_SCOPE = '*';

const PUBLIC_SCOPES = Object.freeze([
  'chat.customer'
]);

function normalizeScope(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeScopes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeScope).filter(Boolean))];
}

function resolveAccessPolicy({
  isOwner = false,
  delegatedScopes = []
} = {}) {
  if (isOwner === true) {
    return Object.freeze({
      role: 'owner',
      fullAccess: true,
      scopes: Object.freeze([OWNER_SCOPE]),
      source: 'owner_identity'
    });
  }

  const scopes = normalizeScopes([
    ...PUBLIC_SCOPES,
    ...normalizeScopes(delegatedScopes)
  ]);

  return Object.freeze({
    role: 'delegated',
    fullAccess: false,
    scopes: Object.freeze(scopes),
    source: delegatedScopes.length
      ? 'delegated_permissions'
      : 'default_customer_policy'
  });
}

function hasScope(policy, requestedScope) {
  if (!policy || typeof policy !== 'object') return false;
  if (policy.fullAccess === true) return true;

  const scope = normalizeScope(requestedScope);
  if (!scope) return false;

  const scopes = Array.isArray(policy.scopes)
    ? policy.scopes
    : [];

  return scopes.includes(scope);
}

function assertScope(policy, requestedScope) {
  if (hasScope(policy, requestedScope)) return true;

  const error = new Error('ACCESS_DENIED');
  error.code = 'ACCESS_DENIED';
  error.scope = normalizeScope(requestedScope) || null;
  error.role = policy?.role || 'unknown';
  throw error;
}

module.exports = {
  OWNER_SCOPE,
  PUBLIC_SCOPES,
  normalizeScope,
  normalizeScopes,
  resolveAccessPolicy,
  hasScope,
  assertScope
};
