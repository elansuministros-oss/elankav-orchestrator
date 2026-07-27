'use strict';

const OWNERS = Object.freeze(['AI', 'HUMAN']);

function normalizeOwner(value, fallback = 'AI') {
  const normalized = String(value || '').trim().toUpperCase();
  return OWNERS.includes(normalized) ? normalized : fallback;
}

function detectOwnershipCommand(message) {
  const value = String(message || '').trim().toLowerCase();
  if (/\b(este cliente lo tomo|yo atiendo este cliente|asign[aá]melo|pas[aá]melo a m[ií])\b/.test(value)) {
    return Object.freeze({ detected: true, owner: 'HUMAN', command: 'TAKE_CONVERSATION' });
  }
  if (/\b(segu[ií] atendiendo este cliente|continu[aá] atendiendo|devolv[eé]lo a la ia|que siga elan ia)\b/.test(value)) {
    return Object.freeze({ detected: true, owner: 'AI', command: 'RELEASE_CONVERSATION' });
  }
  return Object.freeze({ detected: false, owner: null, command: null });
}

function buildOwnershipPolicy({ conversationOwner, isOwnerMessage = false }) {
  const owner = normalizeOwner(conversationOwner);
  return Object.freeze({
    conversationOwner: owner,
    shouldReplyToCustomer: owner === 'AI',
    shouldScheduleFollowUps: owner === 'AI',
    shouldRecordContext: true,
    allowPrivateCopilot: owner === 'HUMAN' && isOwnerMessage,
    suppressionReason: owner === 'HUMAN' ? 'CONVERSATION_OWNED_BY_HUMAN' : null
  });
}

module.exports = {
  OWNERS,
  buildOwnershipPolicy,
  detectOwnershipCommand,
  normalizeOwner
};
