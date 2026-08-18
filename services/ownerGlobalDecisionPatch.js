'use strict';

const conversationClient = require('./connectConversationClient');
const { getOwnerResponseControl } = require('./ownerGlobalControlService');
const { handleDelegationInbound } = require('./businessDelegationService');

let installed = false;

function stripRelationshipMarker(value) {
  return String(value || '')
    .replace(/^\s*\[PROVEEDOR REGISTRADO:[^\]]+\]\s*/i, '')
    .trim();
}

function ownerOnlyDecision(platform, control) {
  return {
    ok: true,
    action: 'NO_REPLY',
    reason: 'owner_only_global',
    platform: { platformId: String(platform || 'ELANVISUAL').toUpperCase() },
    ownerOnly: true,
    control,
    welcome: { send: false, text: '' }
  };
}

function installOwnerGlobalDecisionPatch() {
  if (installed) return false;
  const previousDecision = conversationClient.requestConversationDecision;
  if (typeof previousDecision !== 'function') {
    throw Object.assign(new Error('CONNECT_CONVERSATION_DECISION_REQUIRED'), { code: 'CONNECT_CONVERSATION_DECISION_REQUIRED' });
  }

  conversationClient.requestConversationDecision = async function requestConversationDecisionWithOwnerControl(args = {}, options = {}) {
    if (args.ownerMode !== true) {
      const message = stripRelationshipMarker(args.message);
      if (message) {
        try {
          await handleDelegationInbound({
            phone: args.phone || args.identity,
            text: message,
            occurredAt: new Date().toISOString()
          });
        } catch (error) {
          console.error('[BUSINESS_DELEGATION_INBOUND_FAILED]', { code: error?.code || null, message: error?.message || String(error) });
        }
      }

      try {
        const control = await getOwnerResponseControl();
        if (control?.enabled === true) return ownerOnlyDecision(args.platform, control);
      } catch (error) {
        console.error('[OWNER_RESPONSE_CONTROL_READ_FAILED]', { code: error?.code || null, message: error?.message || String(error) });
      }
    }

    return previousDecision(args, options);
  };

  installed = true;
  console.log('[OWNER_GLOBAL_DECISION_PATCH_INSTALLED]', { ownerOnly: true, delegationTracking: true });
  return true;
}

module.exports = {
  installOwnerGlobalDecisionPatch,
  ownerOnlyDecision,
  stripRelationshipMarker
};
