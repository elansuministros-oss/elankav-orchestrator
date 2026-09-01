'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectSellerTemporaryCredential } = require('../services/ownerSellerTemporaryCredentialPatch');

test('detects natural temporary seller credential delivery command', () => {
  const command = detectSellerTemporaryCredential('ELAN, envíale su contraseña temporal al vendedor Juan Ruiz');
  assert.equal(command?.tool, 'enviar_credencial_temporal_vendedor');
  assert.equal(command?.temporarySellerCredential, true);
  assert.equal(command?.sellerQuery, 'Juan Ruiz');
});

test('does not intercept ordinary seller commands', () => {
  assert.equal(detectSellerTemporaryCredential('ELAN, buscá al vendedor Juan Ruiz'), null);
});
