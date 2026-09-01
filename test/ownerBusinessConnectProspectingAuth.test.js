'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const { prospectingInternalToken } = require('../services/ownerBusinessConnectClient');

test('prospecting usa CONNECT_INTERNAL_API_TOKEN explícito cuando existe', () => {
  assert.equal(
    prospectingInternalToken({
      CONNECT_INTERNAL_API_TOKEN: 'explicit-token',
      VQS_API_TOKEN: 'root-secret'
    }),
    'explicit-token'
  );
});

test('prospecting deriva token de canal desde VQS_API_TOKEN cuando no hay explícito', () => {
  const root = 'root-secret';
  const expected = createHmac('sha256', root)
    .update('ELANKAV_CHANNEL_INTERNAL_V1')
    .digest('hex');

  assert.equal(
    prospectingInternalToken({ VQS_API_TOKEN: root }),
    expected
  );
});

test('prospecting no reutiliza VQS_API_TOKEN crudo como bearer interno', () => {
  const root = 'root-secret';
  const derived = prospectingInternalToken({ VQS_API_TOKEN: root });
  assert.notEqual(derived, root);
  assert.equal(derived.length, 64);
});
