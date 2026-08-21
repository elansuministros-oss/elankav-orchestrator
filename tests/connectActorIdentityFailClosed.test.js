'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveCommercialActor,
  resolveCommercialActorSafely
} = require('../services/connectActorIdentityService');
const {
  resolveAccessPolicy,
  hasScope
} = require('../services/accessPolicyService');

const ENV = Object.freeze({
  ELANKAV_CONNECT_URL: 'https://connect.example.test',
  CONNECT_INTERNAL_TOKEN: 'test-token'
});

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

test('confirmed seller identity passes through with resolved status', async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/api\/v1\/actor-identity\/resolve/);
    return response(200, {
      data: {
        resolutionStatus: 'resolved',
        role: 'seller',
        registered: true,
        actorId: 'seller-1',
        sellerId: 'seller-1',
        scopes: ['price.read', 'quotation.own.create'],
        platformAllowed: true,
        authority: 'crm_sellers'
      }
    });
  };

  const actor = await resolveCommercialActor(
    { phone: '50582121495', platform: 'ELANVISUAL' },
    { fetchImpl, env: ENV }
  );

  assert.equal(actor.resolutionStatus, 'resolved');
  assert.equal(actor.role, 'seller');
  assert.equal(actor.sellerId, 'seller-1');
  assert.equal(actor.authority, 'crm_sellers');
});

test('confirmed unknown identity remains not_found Prospect', async () => {
  const fetchImpl = async () => response(200, {
    data: {
      resolutionStatus: 'not_found',
      role: 'prospect',
      registered: false,
      actorId: '50570000000',
      prospectId: null,
      scopes: ['price.read', 'quotation.formal.request_owner'],
      platformAllowed: true,
      authority: 'whatsapp_unregistered'
    }
  });

  const actor = await resolveCommercialActor(
    { phone: '50570000000', platform: 'ELANVISUAL' },
    { fetchImpl, env: ENV }
  );

  assert.equal(actor.resolutionStatus, 'not_found');
  assert.equal(actor.role, 'prospect');
  assert.equal(actor.registered, false);
});

test('CONNECT identity failure rejects instead of returning Prospect', async () => {
  const fetchImpl = async () => response(503, {
    error: {
      code: 'IDENTITY_AUTHORITY_UNAVAILABLE',
      message: 'No fue posible verificar identidad.'
    }
  });

  await assert.rejects(
    () => resolveCommercialActorSafely(
      { phone: '50582121495', platform: 'ELANVISUAL' },
      { fetchImpl, env: ENV }
    ),
    (error) => {
      assert.equal(error.code, 'IDENTITY_AUTHORITY_UNAVAILABLE');
      assert.notEqual(error.actor?.role, 'prospect');
      assert.equal(error.actor?.role, 'unavailable');
      assert.deepEqual(error.actor?.scopes, []);
      return true;
    }
  );
});

test('transport exception rejects instead of returning Prospect', async () => {
  const fetchImpl = async () => {
    const error = new Error('socket timeout');
    error.code = 'ETIMEDOUT';
    throw error;
  };

  await assert.rejects(
    () => resolveCommercialActorSafely(
      { phone: '50582121495', platform: 'ELANVISUAL' },
      { fetchImpl, env: ENV }
    ),
    (error) => {
      assert.equal(error.code, 'IDENTITY_AUTHORITY_UNAVAILABLE');
      assert.equal(error.actor?.resolutionStatus, 'unavailable');
      assert.equal(error.actor?.role, 'unavailable');
      return true;
    }
  );
});

test('unavailable identity has zero permissions', () => {
  const policy = resolveAccessPolicy({ actorRole: 'unavailable', actorScopes: [] });
  assert.equal(policy.role, 'unavailable');
  assert.equal(policy.source, 'identity_unavailable');
  assert.deepEqual([...policy.scopes], []);
  assert.equal(hasScope(policy, 'price.read'), false);
  assert.equal(hasScope(policy, 'quotation.formal.request_owner'), false);
});

test('family role remains isolated from business permissions', () => {
  const policy = resolveAccessPolicy({
    actorRole: 'family',
    actorScopes: ['assistant.general', 'design.create', 'image.create']
  });

  assert.equal(policy.role, 'family');
  assert.equal(hasScope(policy, 'assistant.general'), true);
  assert.equal(hasScope(policy, 'design.create'), true);
  assert.equal(hasScope(policy, 'price.read'), false);
  assert.equal(hasScope(policy, 'customer.own.read'), false);
  assert.equal(hasScope(policy, 'quotation.own.create'), false);
  assert.equal(hasScope(policy, 'financial.approve'), false);
});
