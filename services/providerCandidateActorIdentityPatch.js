'use strict';

const actorIdentity = require('./connectActorIdentityService');

let installed = false;

function candidateFromInput(input = {}) {
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const decision = metadata.connectDecision && typeof metadata.connectDecision === 'object'
    ? metadata.connectDecision
    : {};
  if (String(decision.relationshipType || '').toLowerCase() !== 'provider_candidate') return null;
  const relationship = decision.relationship && typeof decision.relationship === 'object'
    ? decision.relationship
    : {};
  return {
    name: String(relationship.name || '').trim() || 'Posible proveedor',
    phone: String(relationship.phone || input.phone || '').replace(/\D/g, ''),
    stage: String(relationship.stage || 'evaluation').trim() || 'evaluation'
  };
}

function candidateActor(candidate) {
  return {
    role: 'provider',
    registered: false,
    actorId: null,
    sellerId: null,
    customerId: null,
    providerId: null,
    prospectId: null,
    displayName: candidate.name,
    canonicalPhone: candidate.phone || null,
    scopes: [],
    authority: 'provider_candidate_relationship',
    matchedBy: 'owner_outreach_memory',
    relationshipType: 'provider_candidate',
    relationshipStage: candidate.stage
  };
}

function installProviderCandidateActorIdentityPatch() {
  if (installed) return false;
  const previousSafe = actorIdentity.resolveCommercialActorSafely;
  if (typeof previousSafe !== 'function') {
    throw Object.assign(new Error('CONNECT_ACTOR_IDENTITY_SERVICE_REQUIRED'), {
      code: 'CONNECT_ACTOR_IDENTITY_SERVICE_REQUIRED'
    });
  }

  actorIdentity.resolveCommercialActorSafely = async function resolveCommercialActorSafelyWithProviderCandidate(input = {}, options) {
    const candidate = candidateFromInput(input);
    if (candidate) return candidateActor(candidate);
    return previousSafe(input, options);
  };

  installed = true;
  console.log('[PROVIDER_CANDIDATE_ACTOR_IDENTITY_PATCH_INSTALLED]', {
    salesProspectIsolation: true,
    officialProviderIdGranted: false,
    scopesGranted: 0
  });
  return true;
}

module.exports = {
  candidateActor,
  candidateFromInput,
  installProviderCandidateActorIdentityPatch
};
