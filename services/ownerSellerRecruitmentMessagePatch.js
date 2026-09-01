'use strict';

const messageService = require('./messageService');
const recruitment = require('./ownerSellerRecruitmentService');

let installed = false;

function recruitmentResult(args, handled, actorRole = null) {
  const message = String(args?.message || '').trim();
  return {
    message,
    reply: String(handled?.reply || '').trim() || null,
    provider: 'elankav',
    model: 'elankav-seller-recruitment',
    responseId: null,
    status: 'in_progress',
    usage: null,
    suppressDelivery: false,
    command: null,
    jobId: null,
    ownerCommercialQuery: false,
    ownerCrmCommand: true,
    actorRole,
    actorId: actorRole === 'owner' ? 'owner' : null,
    accessScopes: actorRole === 'owner' ? ['*'] : null,
    runtimeVersion: null,
    knowledgeAvailable: null,
    historyMessages: null
  };
}

function trustedOwnerArgs(args = {}, result = {}) {
  if (String(result?.actorRole || '').toLowerCase() !== 'owner') return args;
  return {
    ...args,
    phone: recruitment.DEFAULT_OWNER_PHONE,
    externalUserId: recruitment.DEFAULT_OWNER_PHONE
  };
}

function installOwnerSellerRecruitmentMessagePatch() {
  if (installed) return false;
  const previousProcessMessage = messageService.processMessage;
  if (typeof previousProcessMessage !== 'function') {
    throw Object.assign(new Error('MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'), { code: 'MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED' });
  }

  messageService.processMessage = async function processMessageWithSellerRecruitment(args = {}) {
    // Fast path for normal phone-based identities and candidate replies.
    const pre = await recruitment.beforeMessage(args);
    if (pre?.handled) return recruitmentResult(args, pre, recruitment.isOwnerIdentity(args) ? 'owner' : null);

    // Let the canonical context resolver identify the actor. This is essential for
    // WhatsApp/GOWS messages that arrive as @lid, where the raw phone is not
    // available to this outer patch even though CONNECT correctly resolves Owner.
    const result = await previousProcessMessage(args);
    const ownerArgs = trustedOwnerArgs(args, result);

    if (String(result?.actorRole || '').toLowerCase() === 'owner') {
      const retry = await recruitment.startRecruitment(ownerArgs);
      if (retry?.handled) return recruitmentResult(args, retry, 'owner');
    }

    return recruitment.afterOwnerMessage(ownerArgs, result);
  };

  installed = true;
  console.log('[OWNER_SELLER_RECRUITMENT_PATCH_INSTALLED]', {
    shortCommand: true,
    candidateReplies: true,
    ownerPreview: true,
    credentialSecondPreview: true,
    ownerLidFallback: true
  });
  return true;
}

module.exports = { installOwnerSellerRecruitmentMessagePatch, trustedOwnerArgs };
