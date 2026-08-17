'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findPhoneInContactPayload,
  normalizePhone,
  resolveCommercialActor
} = require('../services/connectActorIdentityService');

test('LID is never normalized as a telephone number', () => {
  assert.equal(normalizePhone('85504611594419@lid'), '');
});

test('WAHA contact parser rejects LID internals and accepts canonical phone fields', () => {
  assert.equal(
    findPhoneInContactPayload({ id: { user: '85504611594419', _serialized: '85504611594419@lid' } }),
    ''
  );
  assert.equal(
    findPhoneInContactPayload({ id: '85504611594419@lid', phone: '+505 8212 1495' }),
    '50582121495'
  );
});

test('LID-only request reaches CONNECT with identity and WAHA-resolved canonical phone', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url).includes('/api/contacts?')) {
      return {
        ok: true,
        json: async () => ({ id: '85504611594419@lid', number: '+50582121495' })
      };
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          role: 'seller',
          sellerId: 'seller-1',
          actorId: 'seller-1',
          scopes: ['price.read']
        }
      })
    };
  };

  const result = await resolveCommercialActor(
    { phone: '85504611594419@lid', platform: 'ELANVISUAL' },
    {
      fetchImpl,
      env: {
        CONNECT_BASE_URL: 'https://connect.example.test',
        CONNECT_INTERNAL_TOKEN: 'test-token',
        WAHA_BASE_URL: 'https://waha.example.test',
        WAHA_SESSION: 'ELANKAV'
      }
    }
  );

  assert.equal(result.role, 'seller');
  assert.equal(result.sellerId, 'seller-1');
  assert.equal(requests.length, 2);
  assert.match(requests[0], /contactId=85504611594419%40lid/);
  assert.match(requests[1], /phone=50582121495/);
  assert.match(requests[1], /identities=85504611594419%40lid/);
});
