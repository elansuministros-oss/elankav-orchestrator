'use strict';

const { detectFollowUp } = require('./followUpDetector');
const {
  buildOwnershipPolicy,
  detectOwnershipCommand,
  normalizeOwner
} = require('./conversationOwnershipService');

function evaluateCommercialAutonomy({
  message,
  conversationOwner = 'AI',
  isOwnerMessage = false,
  now = new Date()
} = {}) {
  const ownershipCommand = isOwnerMessage
    ? detectOwnershipCommand(message)
    : { detected: false, owner: null, command: null };
  const resolvedOwner = normalizeOwner(
    ownershipCommand.detected ? ownershipCommand.owner : conversationOwner
  );
  const ownership = buildOwnershipPolicy({
    conversationOwner: resolvedOwner,
    isOwnerMessage
  });
  const followUp = ownership.shouldScheduleFollowUps && !isOwnerMessage
    ? detectFollowUp(message, { now })
    : { detected: false };

  return Object.freeze({
    ownershipCommand,
    ownership,
    followUp,
    shouldReply: isOwnerMessage ? true : ownership.shouldReplyToCustomer,
    shouldPersist: true,
    shouldScheduleFollowUp: Boolean(followUp.detected && ownership.shouldScheduleFollowUps),
    suppressionReason: isOwnerMessage ? null : ownership.suppressionReason
  });
}

module.exports = {
  evaluateCommercialAutonomy
};
