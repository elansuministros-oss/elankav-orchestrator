'use strict';

const messageService = require('./messageService');
const updateFlow = require('./ownerSellerUpdateOutreachService');

let installed = false;

function routingArgs(args = {}) {
  const message = String(args?.message || '')
    .replace(/actualizále/gi, 'actualizale')
    .replace(/actualizá/gi, 'actualiza');
  return { ...args, message };
}

function flowResult(args, handled) {
  const message = String(args?.message || '').trim();
  return {
    message,
    reply: String(handled?.reply || '').trim() || null,
    provider: 'elankav',
    model: 'elankav-seller-update-outreach',
    responseId: null,
    status: 'in_progress',
    usage: null,
    suppressDelivery: false,
    command: null,
    jobId: null,
    ownerCommercialQuery: false,
    ownerCrmCommand: true,
    actorRole: handled?.actorRole || null,
    actorId: handled?.actorId || null,
    accessScopes: handled?.accessScopes || null,
    runtimeVersion: null,
    knowledgeAvailable: null,
    historyMessages: null
  };
}

function installOwnerSellerUpdateOutreachMessagePatch() {
  if (installed) return false;
  const previousProcessMessage = messageService.processMessage;
  if (typeof previousProcessMessage !== 'function') {
    throw Object.assign(new Error('MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'), { code: 'MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED' });
  }

  messageService.processMessage = async function processMessageWithSellerUpdateOutreach(args = {}) {
    const routed = routingArgs(args);
    const pre = await updateFlow.beforeMessage(routed);
    if (pre?.handled) return flowResult(args, pre);

    const result = await previousProcessMessage(args);

    // WAHA/GOWS can expose the Owner as @lid to outer patches. If the unified
    // runtime resolved the actor as Owner, retry the short update command using
    // that verified identity instead of falling back to the generic assistant.
    if (String(result?.actorRole || '').toLowerCase() === 'owner') {
      const start = await updateFlow.startUpdateOutreach({
        ...routed,
        ownerVerified: true
      });
      if (start?.handled) return flowResult(args, { ...start, actorRole: 'owner' });
    }

    return updateFlow.afterOwnerMessage(routed, result);
  };

  installed = true;
  console.log('[OWNER_SELLER_UPDATE_OUTREACH_PATCH_INSTALLED]', {
    resolveByName: true,
    sellerOutreach: true,
    updatePreview: true,
    credentialSecondPreview: true
  });
  return true;
}

module.exports = { installOwnerSellerUpdateOutreachMessagePatch, routingArgs };
