'use strict';

const messageService = require('./messageService');
const { resolveCommercialActorSafely } = require('./connectActorIdentityService');
const {
  classifyInboundCommercialRelationship,
  clarificationMessage,
  providerCandidateMessage
} = require('./inboundCommercialRoleService');

const ORIGINAL_PROCESS = messageService.processMessage;
const OWNER_OPS_CONTROL_PATTERN = /^(?:elan\s*[,;:]?\s*)?(?:confirmar\s+OPS-\d+-[A-Z0-9]{6}|(?:estado|estatus|resultado|consulta|consultar|verifica|verificar)\s+OPS-\d+-[A-Z0-9]{6})\b/i;

async function processMessageRoleFirst(input = {}) {
  const channel = String(input.channel || '').trim().toLowerCase();
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const message = String(input.message || '').trim();

  // Owner Ops confirmations/status checks are control-plane commands. They must
  // never be interpreted as a commercial sender classification, even if owner
  // metadata is temporarily missing in the inbound envelope.
  if (
    channel !== 'whatsapp' ||
    metadata.ownerMode === true ||
    metadata.isOwner === true ||
    OWNER_OPS_CONTROL_PATTERN.test(message)
  ) {
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
  OWNER_OPS_CONTROL_PATTERN,
  processMessageRoleFirst
};
