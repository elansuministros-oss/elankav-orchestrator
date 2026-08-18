'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  candidateActor,
  candidateFromInput
} = require('../services/providerCandidateActorIdentityPatch');

test('PROVIDER-CANDIDATE-ACTOR-01 reconoce relación desde connectDecision', () => {
  const candidate = candidateFromInput({
    phone: '50586088087',
    metadata: {
      connectDecision: {
        relationshipType: 'provider_candidate',
        relationship: {
          name: 'Rumbitos Express',
          phone: '50586088087',
          stage: 'evaluation'
        }
      }
    }
  });

  assert.equal(candidate?.name, 'Rumbitos Express');
  assert.equal(candidate?.phone, '50586088087');
});

test('PROVIDER-CANDIDATE-ACTOR-01 no concede providerId ni scopes', () => {
  const actor = candidateActor({
    name: 'Rumbitos Express',
    phone: '50586088087',
    stage: 'evaluation'
  });

  assert.equal(actor.role, 'provider');
  assert.equal(actor.registered, false);
  assert.equal(actor.providerId, null);
  assert.equal(actor.prospectId, null);
  assert.deepEqual(actor.scopes, []);
  assert.equal(actor.relationshipType, 'provider_candidate');
  assert.equal(actor.authority, 'provider_candidate_relationship');
});

test('PROVIDER-CANDIDATE-ACTOR-01 no captura decisiones normales', () => {
  assert.equal(candidateFromInput({
    metadata: { connectDecision: { relationshipType: 'customer' } }
  }), null);
});
