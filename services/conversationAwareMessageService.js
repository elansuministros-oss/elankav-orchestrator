'use strict';

const { processMessage } = require('./messageService');
const { publishConversationEventSafely } = require('./connectConversationEventService');

const SUPPRESS_REPLY_TEXT = '__ELANKAV_HUMAN_TAKEOVER_NO_REPLY__';

function text(value) {
  return String(value ?? '').trim();
}

function latestQuestion(reply) {
  const value = text(reply);
  const index = value.lastIndexOf('?');
  if (index < 0) return null;
  const start = Math.max(value.lastIndexOf('.', index), value.lastIndexOf('\n', index));
  return value.slice(start + 1, index + 1).trim().slice(0, 1000) || null;
}

async function processMessageWithConversationEvents(input = {}, dependencies = {}) {
  const processMessageImpl = dependencies.processMessage || processMessage;
  const publishEventImpl = dependencies.publishConversationEvent || publishConversationEventSafely;
  const metadata = input.metadata || {};
  const chatId = text(metadata.chatId || input.externalUserId);
  const platform = text(input.platform) || 'ELANVISUAL';
  const phone = text(input.phone) || undefined;
  const messageType = text(metadata.messageType) || 'text';
  const inboundText = text(input.message);
  let inboundEvent = null;

  if (chatId && inboundText) {
    inboundEvent = await publishEventImpl({
      externalMessageId: text(metadata.messageId) || undefined,
      direction: 'inbound',
      actor: 'customer',
      chatId,
      phone,
      platform,
      language: 'es-NI',
      text: messageType === 'audio' ? undefined : inboundText,
      transcription: messageType === 'audio' ? inboundText : undefined,
      messageType,
      occurredAt: new Date().toISOString()
    });
  }

  if (text(inboundEvent && inboundEvent.assignment).toLowerCase() === 'human') {
    return {
      reply: SUPPRESS_REPLY_TEXT,
      suppressReply: true,
      provider: 'elankav',
      model: null,
      status: 'human_takeover',
      context: {
        platform,
        channel: 'whatsapp',
        externalUserId: input.externalUserId || null,
        ownerMode: false,
        commercialState: null,
        assignment: 'human'
      },
      createdAt: new Date().toISOString()
    };
  }

  const result = await processMessageImpl(input);
  const reply = text(result && result.reply);
  const state = result && result.context ? result.context.commercialState : null;

  if (chatId && reply) {
    await publishEventImpl({
      direction: 'outbound',
      actor: 'elan_ai',
      chatId,
      phone,
      platform: text(result && result.context && result.context.platform) || platform,
      language: 'es-NI',
      text: reply,
      messageType: 'text',
      intent: text(state && state.intent) || undefined,
      phase: text(state && (state.conversationStatus || state.phase)) || undefined,
      lastQuestion: latestQuestion(reply) || undefined,
      assignment: 'ai',
      occurredAt: text(result && result.createdAt) || new Date().toISOString()
    });
  }

  return result;
}

module.exports = {
  SUPPRESS_REPLY_TEXT,
  processMessageWithConversationEvents
};
