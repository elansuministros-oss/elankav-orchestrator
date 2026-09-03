'use strict';

const { downloadWahaMedia, resolveAudioMimeType, synthesizeSpeech, transcribeAudio } = require('./connectVoiceService');
const { processMessage } = require('./messageService');
const {
  normalizeReplyForTextDelivery,
  replyContainsNavigableLink
} = require('./voiceReplyDeliveryPolicy');
const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');
const { createWahaVoiceMediaAdapterV2 } = require('../adapters/wahaVoiceMediaAdapterV2');
const { publishConversationEventSafely } = require('./connectConversationClient');

const TTL_MS = 10 * 60 * 1000;
const states = new Map();

function correlationId(messageId) {
  const value = String(messageId || 'unknown');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return `vp2-${Math.abs(hash).toString(36)}`;
}

function log(stage, event, extra = {}) {
  console.log('[VOICE_PIPELINE_V2]', {
    stage,
    correlationId: correlationId(event.messageId),
    messageIdPresent: Boolean(event.messageId),
    ...extra
  });
}

function cleanup(now = Date.now()) {
  for (const [key, value] of states.entries()) {
    if (value.expiresAt <= now) states.delete(key);
  }
}

function acquire(messageId, now = Date.now()) {
  cleanup(now);
  const key = String(messageId || '').trim();
  if (!key) return { acquired: true, key: '' };
  if (states.has(key)) return { acquired: false, key };
  states.set(key, { status: 'PROCESSING', expiresAt: now + TTL_MS });
  return { acquired: true, key };
}

function complete(key, now = Date.now()) {
  if (key) states.set(key, { status: 'COMPLETED', expiresAt: now + TTL_MS });
}

function release(key) {
  if (key) states.delete(key);
}

async function runVoicePipelineV2(event, dependencies = {}) {
  const lock = acquire(event.messageId);
  if (!lock.acquired) return { duplicate: true, processed: false };

  const runtimeEnv = dependencies.env || process.env;
  const mediaAdapter = dependencies.mediaAdapter || createWahaVoiceMediaAdapterV2({ env: runtimeEnv });
  const delivery = dependencies.delivery || createWahaDeliveryAdapter({
    env: { ...runtimeEnv, WAHA_SESSION: event.session || runtimeEnv.WAHA_SESSION }
  });
  const download = dependencies.downloadWahaMedia || downloadWahaMedia;
  const transcribe = dependencies.transcribeAudio || transcribeAudio;
  const processMessageImpl = dependencies.processMessage || processMessage;
  const synthesize = dependencies.synthesizeSpeech || synthesizeSpeech;

  try {
    log('RECEIVED', event);
    let media = event.media || {};
    if (!media.url) {
      log('MESSAGE_RECOVERY_STARTED', event);
      media = await mediaAdapter.recoverMessage({ session: event.session, messageId: event.messageId });
      log('MESSAGE_RECOVERY_COMPLETED', event);
    }

    log('DOWNLOAD_STARTED', event);
    const downloaded = await download({ url: media.url });
    log('DOWNLOAD_COMPLETED', event, { size: downloaded.buffer?.length || 0 });

    const mimeType = resolveAudioMimeType({
      downloadedMimeType: downloaded.mimeType,
      webhookMimeType: media.mimeType
    });
    log('TRANSCRIPTION_STARTED', event, { mimeType });
    const text = String(await transcribe({
      audio: downloaded.buffer,
      mimeType,
      filename: media.filename || 'voice.ogg'
    }) || '').trim();
    if (!text) {
      throw Object.assign(new Error('VOICE_TRANSCRIPTION_EMPTY'), { code: 'VOICE_TRANSCRIPTION_EMPTY' });
    }
    log('TRANSCRIPTION_COMPLETED', event);

    await publishConversationEventSafely({
      platform: runtimeEnv.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL',
      channel: 'whatsapp',
      externalUserId: event.senderRaw,
      phone: event.phone,
      chatId: event.chatId,
      direction: 'inbound',
      text,
      messageType: 'audio',
      externalMessageId: event.messageId || null,
      actorType: 'customer',
      actorName: 'WhatsApp',
      metadata: {
        source: 'waha',
        pipeline: 'voice-v2',
        session: event.session,
        media: event.media || null
      }
    }, { env: runtimeEnv });

    log('AI_STARTED', event);
    const result = await processMessageImpl({
      message: text,
      platform: runtimeEnv.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL',
      channel: 'whatsapp',
      externalUserId: event.senderRaw,
      phone: event.phone,
      metadata: {
        source: 'waha',
        pipeline: 'voice-v2',
        session: event.session,
        messageId: event.messageId,
        chatId: event.chatId,
        messageType: 'audio'
      }
    });
    const reply = String(result?.reply || '').trim();
    if (!reply) {
      throw Object.assign(new Error('VOICE_AI_REPLY_EMPTY'), { code: 'VOICE_AI_REPLY_EMPTY' });
    }
    log('AI_COMPLETED', event);

    if (replyContainsNavigableLink(reply)) {
      const textReply = normalizeReplyForTextDelivery(reply);
      await delivery.sendText({ chatId: event.chatId, text: textReply });
      await publishConversationEventSafely({
        platform: runtimeEnv.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL',
        channel: 'whatsapp',
        externalUserId: event.senderRaw,
        phone: event.phone,
        chatId: event.chatId,
        direction: 'outbound',
        text: textReply,
        messageType: 'text',
        externalMessageId: null,
        actorType: 'assistant',
        actorName: 'ELAN IA',
        metadata: {
          source: 'waha',
          pipeline: 'voice-v2',
          session: event.session,
          replyType: 'text',
          forcedTextFromAudio: true,
          reason: 'reply_contains_link'
        }
      }, { env: runtimeEnv });
      log('LINK_TEXT_SENT', event);
      complete(lock.key);
      log('COMPLETED', event);
      return {
        processed: true,
        replySent: true,
        replyType: 'text',
        audioLinkTextDelivery: true
      };
    }

    try {
      log('SPEECH_STARTED', event);
      const speech = await synthesize({ text: reply });
      await delivery.sendVoice({
        chatId: event.chatId,
        data: speech.data,
        mimeType: speech.mimeType || 'audio/ogg'
      });
      log('VOICE_REPLY_SENT', event);
      complete(lock.key);
      log('COMPLETED', event);
      return { processed: true, replySent: true, replyType: 'voice' };
    } catch (speechError) {
      await delivery.sendText({ chatId: event.chatId, text: reply });
      await publishConversationEventSafely({
        platform: runtimeEnv.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL',
        channel: 'whatsapp',
        externalUserId: event.senderRaw,
        phone: event.phone,
        chatId: event.chatId,
        direction: 'outbound',
        text: reply,
        messageType: 'text',
        externalMessageId: null,
        actorType: 'assistant',
        actorName: 'ELAN IA',
        metadata: {
          source: 'waha',
          pipeline: 'voice-v2',
          session: event.session,
          replyType: 'text',
          fallbackFrom: 'voice'
        }
      }, { env: runtimeEnv });
      log('TEXT_FALLBACK_SENT', event, {
        errorCode: speechError.code || 'VOICE_SPEECH_FAILED'
      });
      complete(lock.key);
      log('COMPLETED', event);
      return { processed: true, replySent: true, replyType: 'text' };
    }
  } catch (error) {
    release(lock.key);
    log('FAILED', event, { errorCode: error.code || 'VOICE_PIPELINE_V2_FAILED' });
    throw error;
  }
}

function clearVoicePipelineV2Dedupe() {
  states.clear();
}

module.exports = { clearVoicePipelineV2Dedupe, runVoicePipelineV2 };
