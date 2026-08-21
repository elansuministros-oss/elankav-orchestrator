'use strict';

const messageService = require('./messageService');
const { resolveCommercialActorSafely } = require('./connectActorIdentityService');
const { handleSellerConversationMessage } = require('./sellerConversationRuntimeService');

const INSTALL_MARK = Symbol.for('elankav.sellerBusinessRuntimeIntegration.installed');

function resultFromSeller(args, actor, outcome) {
  return {
    message: String(args?.message || '').trim(),
    reply: outcome.outputText || '',
    provider: 'elankav',
    model: 'elan-seller-business-runtime',
    responseId: null,
    status: 'completed',
    usage: null,
    suppressDelivery: false,
    command: 'seller_business_runtime',
    jobId: null,
    ownerCommercialQuery: false,
    ownerCrmCommand: false,
    ownerBusinessCommand: false,
    sellerBusinessCommand: true,
    actorRole: 'seller',
    actorId: actor?.actorId || actor?.sellerId || null,
    accessScopes: actor?.scopes || [],
    knowledgeAvailable: true,
    historyMessages: null,
    context: {
      platform: args?.platform || 'ELANVISUAL',
      channel: args?.channel || 'whatsapp',
      externalUserId: args?.externalUserId || null,
      ownerMode: false,
      sellerMode: true,
      runtime: 'ELAN_SELLER_BUSINESS_RUNTIME',
      authority: 'CONNECT'
    }
  };
}

function installSellerBusinessRuntimeIntegration(service = messageService) {
  if (!service || typeof service.processMessage !== 'function') {
    throw new TypeError('messageService.processMessage no está disponible');
  }
  if (service[INSTALL_MARK]) return service.processMessage;

  const original = service.processMessage;
  service.processMessage = async function processMessageWithSellerBusinessRuntime(args = {}) {
    const channel = String(args?.channel || '').toLowerCase();
    if (channel !== 'whatsapp') return original(args);

    try {
      const actor = await resolveCommercialActorSafely({
        phone: args?.phone || null,
        identity: args?.externalUserId || args?.metadata?.senderRaw || args?.metadata?.chatId || null,
        externalUserId: args?.externalUserId || null,
        chatId: args?.metadata?.chatId || null,
        metadata: args?.metadata && typeof args.metadata === 'object' ? args.metadata : {},
        platform: args?.platform || 'ELANVISUAL'
      });

      if (String(actor?.role || '').toLowerCase() === 'seller') {
        const outcome = await handleSellerConversationMessage(args?.message, actor);
        if (outcome?.handled) {
          console.log('[SELLER_BUSINESS_RUNTIME_HANDLED]', {
            sellerId: actor?.sellerId || actor?.actorId || null,
            platform: args?.platform || 'ELANVISUAL'
          });
          return resultFromSeller(args, actor, outcome);
        }
      }
    } catch (error) {
      console.error('[SELLER_BUSINESS_RUNTIME_FAILED]', {
        code: error?.code || null,
        message: error?.message || null
      });
      return {
        message: String(args?.message || '').trim(),
        reply: `No pude completar la operación comercial en CONNECT. Error: ${error?.code || 'SELLER_BUSINESS_RUNTIME_FAILED'}. No creé ni envié datos alternativos.`,
        provider: 'elankav',
        model: 'elan-seller-business-runtime',
        responseId: null,
        status: 'failed',
        usage: null,
        suppressDelivery: false,
        command: 'seller_business_runtime',
        jobId: null,
        sellerBusinessCommand: true,
        actorRole: 'seller',
        accessScopes: [],
        knowledgeAvailable: false
      };
    }

    return original(args);
  };

  service[INSTALL_MARK] = true;
  return service.processMessage;
}

installSellerBusinessRuntimeIntegration();

module.exports = {
  installSellerBusinessRuntimeIntegration,
  resultFromSeller
};
