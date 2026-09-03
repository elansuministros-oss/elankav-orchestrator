'use strict';

const NAVIGABLE_LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+|(?<!@)\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/i;

function replyContainsNavigableLink(value) {
  return NAVIGABLE_LINK_PATTERN.test(String(value || ''));
}

function normalizeReplyForTextDelivery(value) {
  return String(value || '')
    .replace(/<\/?audio>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shouldForceTextForAudioReply({ incomingMessageType, reply } = {}) {
  return String(incomingMessageType || '').toLowerCase() === 'audio'
    && replyContainsNavigableLink(reply);
}

module.exports = {
  NAVIGABLE_LINK_PATTERN,
  normalizeReplyForTextDelivery,
  replyContainsNavigableLink,
  shouldForceTextForAudioReply
};
