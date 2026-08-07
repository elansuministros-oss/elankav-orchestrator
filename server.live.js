'use strict';

const wahaWebhookApi = require('./api/wahaWebhookApi');
const { processMessageWithConversationEvents } = require('./services/conversationAwareMessageService');

const originalHandleWahaWebhookApi = wahaWebhookApi.handleWahaWebhookApi;

wahaWebhookApi.handleWahaWebhookApi = function handleWahaWebhookApiWithConversationEvents(args = {}) {
  return originalHandleWahaWebhookApi({
    ...args,
    dependencies: {
      ...(args.dependencies || {}),
      processMessage: processMessageWithConversationEvents
    }
  });
};

require('./server');
