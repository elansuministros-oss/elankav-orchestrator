'use strict';

const messageService = require('./messageService');
const recruitment = require('./ownerSellerRecruitmentService');

let installed = false;

function recruitmentResult(args, handled) {
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
    actorRole: null,
    actorId: null,
    accessScopes: null,
    runtimeVersion: null,
    knowledgeAvailable: null,
    historyMessages: null
  };
}

function installOwnerSellerRecruitmentMessagePatch() {
  if (installed) return false;
  const previousProcessMessage = messageService.processMessage;
  if (typeof previousProcessMessage !== 'function') {
    throw Object.assign(new Error('MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'), { code: 'MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED' });
  }

  messageService.processMessage = async function processMessageWithSellerRecruitment(args = {}) {
    const pre = await recruitment.beforeMessage(args);
    if (pre?.handled) return recruitmentResult(args, pre);

    const result = await previousProcessMessage(args);
    return recruitment.afterOwnerMessage(args, result);
  };

  installed = true;
  console.log('[OWNER_SELLER_RECRUITMENT_PATCH_INSTALLED]', {
    shortCommand: true,
    candidateReplies: true,
    ownerPreview: true,
    credentialSecondPreview: true
  });
  return true;
}

module.exports = { installOwnerSellerRecruitmentMessagePatch };
