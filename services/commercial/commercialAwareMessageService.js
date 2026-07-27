'use strict';

const { processMessage } = require('../messageService');
const { coordinateCommercialMessage } = require('./commercialConversationCoordinator');
const {
  createConnectCommercialPersistenceAdapter
} = require('./connectCommercialPersistenceAdapter');

function resolveConversationRef({ externalUserId, phone, metadata } = {}) {
  return String(
    metadata?.conversationRef ||
    externalUserId ||
    phone ||
    ''
  ).trim();
}

function createCommercialAwareMessageProcessor({
  processMessageImpl = processMessage,
  persistence = createConnectCommercialPersistenceAdapter(),
  logger = console
} = {}) {
  return async function processCommercialAwareMessage(input = {}) {
    const conversationRef = resolveConversationRef(input);
    const isOwnerMessage = Boolean(input.metadata?.isOwnerMessage);
    let commercialDecision = null;

    if (conversationRef) {
      try {
        commercialDecision = await coordinateCommercialMessage({
          persistence,
          conversationRef,
          message: input.message,
          isOwnerMessage,
          context: {
            platform: input.platform || null,
            channel: input.channel || null,
            externalUserId: input.externalUserId || null,
            phone: input.phone || null,
            source: input.metadata?.source || null
          }
        });
      } catch (error) {
        logger.error('[COMMERCIAL_COORDINATION_UNAVAILABLE]', {
          message: error.message,
          code: error.code || null,
          status: error.status || null,
          conversationRef
        });
      }
    }

    if (commercialDecision?.shouldReply === false) {
      return {
        message: String(input.message || '').trim(),
        reply: '',
        provider: 'elankav',
        model: 'elankav-commercial-ownership',
        responseId: null,
        status: 'suppressed',
        usage: null,
        design: null,
        command: null,
        jobId: null,
        shouldReply: false,
        suppressionReason: commercialDecision.suppressionReason,
        commercial: commercialDecision,
        context: {
          version: null,
          platform: input.platform || null,
          channel: input.channel || null,
          externalUserId: input.externalUserId || null,
          ownerMode: false
        },
        createdAt: new Date().toISOString()
      };
    }

    const result = await processMessageImpl(input);
    return {
      ...result,
      shouldReply: true,
      suppressionReason: null,
      commercial: commercialDecision
    };
  };
}

const processCommercialAwareMessage = createCommercialAwareMessageProcessor();

module.exports = {
  createCommercialAwareMessageProcessor,
  processCommercialAwareMessage,
  resolveConversationRef
};