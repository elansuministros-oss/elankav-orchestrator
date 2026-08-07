'use strict';

const { processMessage } = require('./messageService');
const { publishConversationEventSafely } = require('./connectConversationEventService');

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

async function processMessageWithConversationEvents(input = {}) {
  const metadata = input.metadata || {};
  const chatId = text(metadata.chatId || input.externalUserId);
  const platform = text(input.platform) || 'ELANVISUAL';
  const phone = text(input.phone) || undefined;
  const messageType = text(metadata.messageType) || 'text';
  const inboundText = text(input.message);

  if (chatId && inboundText) {
    await publishConversationEventSafely({
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
      mediaUrl: text(metadata.mediaUrl) || undefined,
      occurredAt: new Date().toISOString()
    });
  }

  const result = await processMessage(input);
  const reply = text(result?.reply);
  const state = result?.context?.commercialState || null;

  if (chatId && reply) {
    await publishConversationEventSafely({
      direction: 'outbound',
      actor: 'elan_ai',
      chatId,
      phone,
      platform: text(result?.context?.platform) || platform,
      language: 'es-NI',
      text: reply,
      messageType: 'text',
      intent: text(state?.intent) || undefined,
      phase: text(state?.conversationStatus || state?.phase) || undefined,
      lastQuestion: latestQuestion(reply) || undefined,
      assignment: 'ai',
      occurredAt: text(result?.createdAt) || new Date().toISOString()
    });
  }

  return result;
}

module.exports = {
  processMessageWithConversationEvents
};
