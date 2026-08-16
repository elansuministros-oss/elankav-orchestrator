'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveCommercialActor
} = require('../services/connectActorIdentityService');
const {
  resolveAccessPolicy,
  hasScope
} = require('../services/accessPolicyService');

test('seller identity from CONNECT keeps seller-only commercial scopes', async () => {
  const fetchImpl = async url => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, '/api/v1/actor-identity/resolve');
    assert.equal(parsed.searchParams.get('phone'), '50582121495');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          role: 'seller',
          actorId: 'seller-1',
          sellerId: 'seller-1',
          customerId: null,
          scopes: ['price.read', 'quotation.own.create', 'platform.deep_link.own'],
          authority: 'crm_sellers'
        }
      })
    };
  };

  const actor = await resolveCommercialActor(
    { phone: '+505 8212-1495', platform: 'ELANVISUAL' },
    {
      fetchImpl,
      env: {
        CONNECT_INTERNAL_TOKEN: 'test-token',
        ELANKAV_CONNECT_URL: 'https://connect.example.test'
      }
    }
  );

  const policy = resolveAccessPolicy({ actorRole: actor.role, actorScopes: actor.scopes });
  assert.equal(policy.role, 'seller');
  assert.equal(hasScope(policy, 'quotation.own.create'), true);
  assert.equal(hasScope(policy, 'quotation.self.request'), false);
});

test('registered customer cannot obtain seller deep links or authorize OT', () => {
  const policy = resolveAccessPolicy({
    actorRole: 'customer',
    actorScopes: ['price.read', 'quotation.self.request', 'receipt.self.read']
  });

  assert.equal(policy.role, 'customer');
  assert.equal(hasScope(policy, 'quotation.self.request'), true);
  assert.equal(hasScope(policy, 'platform.deep_link.own'), false);
  assert.equal(hasScope(policy, 'work_order.authorize'), false);
});

test('prospect gets price access but formal quote requires Owner flow', () => {
  const policy = resolveAccessPolicy({ actorRole: 'prospect' });
  assert.equal(policy.role, 'prospect');
  assert.equal(hasScope(policy, 'price.read'), true);
  assert.equal(hasScope(policy, 'quotation.formal.request_owner'), true);
  assert.equal(hasScope(policy, 'quotation.own.create'), false);
});
