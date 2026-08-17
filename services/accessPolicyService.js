'use strict';

const OWNER_SCOPE = '*';

const PUBLIC_SCOPES = Object.freeze([
  'chat.customer'
]);

const ROLE_SCOPES = Object.freeze({
  seller: Object.freeze([
    'chat.seller',
    'price.read',
    'customer.own.read',
    'customer.own.create',
    'quotation.own.read',
    'quotation.own.create',
    'quotation.own.send',
    'work_order.own.read',
    'commission.own.read',
    'platform.deep_link.own'
  ]),
  customer: Object.freeze([
    'chat.customer',
    'price.read',
    'quotation.self.read',
    'quotation.self.request',
    'receipt.self.read',
    'work_status.self.read'
  ]),
  provider: Object.freeze([
    'chat.provider',
    'provider.self.read',
    'provider.commercial_data.submit'
  ]),
  prospect: Object.freeze([
    'chat.customer',
    'price.read',
    'quotation.formal.request_owner'
  ])
});

function normalizeScope(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeScopes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeScope).filter(Boolean))];
}

function resolveAccessPolicy({
  isOwner = false,
  actorRole = '',
  actorScopes = [],
  delegatedScopes = [],
  delegationTrusted = false
} = {}) {
  if (isOwner === true || String(actorRole || '').trim().toLowerCase() === 'owner') {
    return Object.freeze({
      role: 'owner',
      fullAccess: true,
      scopes: Object.freeze([OWNER_SCOPE]),
      source: 'owner_identity'
    });
  }

  const normalizedRole = String(actorRole || '').trim().toLowerCase();
  const roleScopes = ROLE_SCOPES[normalizedRole] || null;

  if (roleScopes) {
    const connectorScopes = normalizeScopes(actorScopes);
    const authoritative = connectorScopes.length ? connectorScopes : roleScopes;
    return Object.freeze({
      role: normalizedRole,
      fullAccess: false,
      scopes: Object.freeze(normalizeScopes(authoritative)),
      source: connectorScopes.length ? 'connect_actor_identity' : 'role_policy'
    });
  }

  const trustedDelegatedScopes = delegationTrusted === true
    ? normalizeScopes(delegatedScopes)
    : [];

  const scopes = normalizeScopes([
    ...PUBLIC_SCOPES,
    ...trustedDelegatedScopes
  ]);

  return Object.freeze({
    role: trustedDelegatedScopes.length ? 'delegated' : 'prospect',
    fullAccess: false,
    scopes: Object.freeze(scopes),
    source: trustedDelegatedScopes.length
      ? 'trusted_delegated_permissions'
      : 'default_prospect_policy'
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
  ROLE_SCOPES,
  normalizeScope,
  normalizeScopes,
  resolveAccessPolicy,
  hasScope,
  assertScope
};
