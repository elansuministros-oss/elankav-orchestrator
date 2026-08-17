'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { actorInstructions } = require('../services/messageService');

function policy(role, scopes) {
  return { role, scopes, fullAccess: false };
}

test('seller is treated as internal seller, never as prospect', () => {
  const text = actorInstructions(
    { role: 'seller' },
    policy('seller', ['price.read', 'quotation.own.create'])
  );
  assert.match(text, /vendedor interno/i);
  assert.doesNotMatch(text, /prospecto\/no registrado/i);
});

test('customer is treated as formal customer, never as prospect', () => {
  const text = actorInstructions(
    { role: 'customer' },
    policy('customer', ['quotation.self.read'])
  );
  assert.match(text, /cliente formal/i);
  assert.doesNotMatch(text, /prospecto\/no registrado/i);
});

test('provider is treated as registered provider, never as prospect', () => {
  const text = actorInstructions(
    { role: 'provider' },
    policy('provider', ['provider.self.read'])
  );
  assert.match(text, /proveedor registrado/i);
  assert.doesNotMatch(text, /prospecto\/no registrado/i);
});
