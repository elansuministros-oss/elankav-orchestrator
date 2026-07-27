'use strict';

const { evaluateCommercialAutonomy } = require('./commercialAutonomyService');
const { validateCommercialPersistencePort } = require('./commercialPersistencePort');

async function coordinateCommercialMessage({
  persistence,
  conversationRef,
  message,
  isOwnerMessage = false,
  now = new Date(),
  context = {}
} = {}) {
  if (!conversationRef) {
    const error = new Error('COMMERCIAL_CONVERSATION_REF_REQUIRED');
    error.code = 'COMMERCIAL_CONVERSATION_REF_REQUIRED';
    throw error;
  }

  const port = validateCommercialPersistencePort(persistence);
  const control = await port.getConversationControl({ conversationRef });
  const decision = evaluateCommercialAutonomy({
    message,
    conversationOwner: control?.conversationOwner || 'AI',
    isOwnerMessage,
    now
  });

  let savedControl = control || null;
  if (decision.ownershipCommand.detected) {
    savedControl = await port.saveConversationControl({
      conversationRef,
      conversationOwner: decision.ownership.conversationOwner,
      reason: decision.ownershipCommand.command,
      context
    });
  }

  await port.recordCommercialObservation({
    conversationRef,
    message,
    conversationOwner: decision.ownership.conversationOwner,
    shouldReply: decision.shouldReply,
    suppressionReason: decision.suppressionReason,
    followUp: decision.followUp,
    context
  });

  let followUp = null;
  if (decision.shouldScheduleFollowUp) {
    followUp = await port.createFollowUp({
      conversationRef,
      dueAt: decision.followUp.dueAt,
      priority: decision.followUp.priority,
      reason: decision.followUp.reason,
      confidence: decision.followUp.confidence,
      sourceText: decision.followUp.sourceText,
      context
    });
  }

  return Object.freeze({
    ...decision,
    control: savedControl,
    followUpRecord: followUp
  });
}

module.exports = {
  coordinateCommercialMessage
};
