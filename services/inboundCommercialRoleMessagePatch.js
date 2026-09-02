'use strict';

const messageService = require('./messageService');
const { resolveCommercialActorSafely } = require('./connectActorIdentityService');
const {
  classifyInboundCommercialRelationship,
  clarificationMessage,
  providerCandidateMessage
} = require('./inboundCommercialRoleService');

const ORIGINAL_PROCESS = messageService.processMessage;

async function processMessageRoleFirst(input = {}) {
  const channel = String(input.channel || '').trim().toLowerCase();
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  if (channel !== 'whatsapp' || metadata.ownerMode === true || metadata.isOwner === true) {
    return ORIGINAL_PROCESS(input);
  }

  let actor = null;
  try {
    actor = await resolveCommercialActorSafely({
      phone: input.phone || null,
      identity: input.externalUserId || metadata.senderRaw || metadata.chatId || null,
      externalUserId: input.externalUserId || null,
      chatId: metadata.chatId || null,
      metadata,
      platform: input.platform || 'ELANVISUAL'
    });
  } catch (error) {
    console.error('[INBOUND_ROLE_IDENTITY_LOOKUP_FAILED]', { code: error?.code || null });
  }

  const classification = classifyInboundCommercialRelationship({ message: input.message, actor });
  console.log('[INBOUND_COMMERCIAL_ROLE]', {
    kind: classification.kind,
    source: classification.source,
    confidence: classification.confidence,
    knownRole: classification.role || null
  });

  if (classification.kind === 'provider_candidate') {
    return {
      outputText: providerCandidateMessage(),
      model: 'elankav-role-first-router',
      id: null,
      status: 'completed',
      usage: null,
      actorRole: 'provider_candidate',
      commercialRelationship: classification.kind
    };
  }

  if (classification.kind === 'ambiguous') {
    return {
      outputText: clarificationMessage(),
      model: 'elankav-role-first-router',
      id: null,
      status: 'completed',
      usage: null,
      actorRole: 'unclassified',
      commercialRelationship: classification.kind
    };
  }

  return ORIGINAL_PROCESS(input);
}

messageService.processMessage = processMessageRoleFirst;

module.exports = {
  processMessageRoleFirst
};
