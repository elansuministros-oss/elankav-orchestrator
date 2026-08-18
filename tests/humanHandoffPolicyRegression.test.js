'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handoffReason,
  isProviderOrInternal,
  transferReply
} = require('../services/humanHandoffPolicyPatch');

test('HUMAN-HANDOFF-01 petición explícita de persona activa handoff', () => {
  const reason = handoffReason('Quiero hablar con una persona del equipo, por favor.', null, []);
  assert.equal(reason, 'customer_requested_human');
});

test('HUMAN-HANDOFF-01 frustración fuerte activa handoff', () => {
  const reason = handoffReason('Ya te dije varias veces y no me estás entendiendo.', null, []);
  assert.equal(reason, 'customer_frustration');
});

test('HUMAN-HANDOFF-01 incertidumbre propia de ELAN activa transferencia segura', () => {
  const reason = handoffReason('¿Entonces sí se puede?', { reply: 'No puedo confirmar esa autorización con seguridad.' }, []);
  assert.equal(reason, 'assistant_cannot_resolve_safely');
});

test('HUMAN-HANDOFF-01 proveedor y provider_candidate quedan fuera de la política de cliente', () => {
  assert.equal(isProviderOrInternal({ metadata: { connectDecision: { relationshipType: 'provider_candidate' } } }, {}), true);
  assert.equal(isProviderOrInternal({}, { actorRole: 'provider' }), true);
  assert.equal(isProviderOrInternal({}, { actorRole: 'seller' }), true);
  assert.equal(isProviderOrInternal({}, { actorRole: 'prospect' }), false);
});

test('HUMAN-HANDOFF-01 mensaje de transferencia no promete una respuesta inventada', () => {
  assert.match(transferReply(), /pasar esta conversación con una persona/i);
  assert.doesNotMatch(transferReply(), /en \d+ minutos/i);
});
