'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOwnerPurpose,
  resolveProviderIntake,
  providerAiDisclosure,
  providerDiscoveryQuestions,
  providerNegotiationPolicy
} = require('../services/providerIntakePolicyService');

test('unknown provider input asks owner intent before acting', () => {
  const result = resolveProviderIntake({ identity: '50588887777', ownerText: '' });
  assert.equal(result.action, 'ask_owner_intent');
  assert.match(result.prompt, /no está registrado/i);
  assert.equal(result.canonicalIdentity.canonicalId, '50588887777');
});

test('registered provider input also asks intent when owner did not specify action', () => {
  const result = resolveProviderIntake({ identity: '50588887777', registeredProvider: { id: 'p1' } });
  assert.equal(result.action, 'ask_owner_intent');
  assert.match(result.prompt, /ya está registrado/i);
});

test('owner can request registration or research in natural language', () => {
  assert.equal(detectOwnerPurpose('Agregá este nuevo proveedor'), 'register_provider');
  assert.equal(detectOwnerPurpose('Averiguá qué ofrece y conseguí tarifario'), 'research_provider');
});

test('provider disclosure explicitly identifies ELAN as AI', () => {
  assert.match(providerAiDisclosure(), /inteligencia artificial/i);
});

test('discovery asks for reseller economics', () => {
  const questions = providerDiscoveryQuestions().join(' ');
  assert.match(questions, /revendedores/i);
  assert.match(questions, /descuento/i);
  assert.match(questions, /compra mínima/i);
  assert.match(questions, /condiciones de pago/i);
});

test('negotiation cannot officialize observations without owner approval', () => {
  const policy = providerNegotiationPolicy();
  assert.equal(policy.discloseAi, true);
  assert.equal(policy.officialization, 'owner_approval_required');
  assert.ok(policy.prohibited.includes('publish_observed_price_as_official'));
  assert.ok(policy.prohibited.includes('hide_ai_identity_from_provider'));
});
