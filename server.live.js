'use strict';

const wahaWebhookApi = require('./api/wahaWebhookApi');
const { synthesizeSpeech } = require('./services/connectVoiceService');
const {
  SUPPRESS_REPLY_TEXT,
  processMessageWithConversationEvents
} = require('./services/conversationAwareMessageService');

const originalHandleWahaWebhookApi = wahaWebhookApi.handleWahaWebhookApi;
const SUPPRESS_VOICE_MIME = 'application/x-elankav-human-takeover';

wahaWebhookApi.handleWahaWebhookApi = function handleWahaWebhookApiWithConversationEvents(args = {}) {
  const existing = args.dependencies || {};
  const sendText = existing.sendWahaText || wahaWebhookApi.sendWahaText;
  const sendVoice = existing.sendWahaVoice || wahaWebhookApi.sendWahaVoice;
  const synthesize = existing.synthesizeSpeech || synthesizeSpeech;

  return originalHandleWahaWebhookApi({
    ...args,
    dependencies: {
      ...existing,
      processMessage: processMessageWithConversationEvents,
      sendWahaText: async payload => {
        if (String(payload && payload.text || '').trim() === SUPPRESS_REPLY_TEXT) {
          return { ok: true, suppressed: true, reason: 'HUMAN_TAKEOVER' };
        }
        return sendText(payload);
      },
      synthesizeSpeech: async payload => {
        if (String(payload && payload.text || '').trim() === SUPPRESS_REPLY_TEXT) {
          return { data: Buffer.alloc(0), mimeType: SUPPRESS_VOICE_MIME, suppressed: true };
        }
        return synthesize(payload);
      },
      sendWahaVoice: async payload => {
        if (payload && payload.mimeType === SUPPRESS_VOICE_MIME) {
          return { ok: true, suppressed: true, reason: 'HUMAN_TAKEOVER' };
        }
        return sendVoice(payload);
      }
    }
  });
};

require('./server');
