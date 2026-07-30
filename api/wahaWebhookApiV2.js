'use strict';

const { processMessage } = require('../services/messageService');
const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');
const { normalizeWahaVoiceEvent } = require('../modules/voicePipelineV2/wahaVoiceEvent');
const { runVoicePipelineV2 } = require('../services/voicePipelineV2Service');
const { extractIncoming, normalizePhone } = require('./wahaWebhookApi');

const MAX_BODY_BYTES = 1024 * 1024;
const DEDUPE_TTL_MS = 10 * 60 * 1000;
const processedTextMessageIds = new Map();

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let receivedBytes = 0;
    let settled = false;

    req.on('data', chunk => {
      if (settled) return;
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        settled = true;
        const error = new Error('PAYLOAD_TOO_LARGE');
        error.code = 'PAYLOAD_TOO_LARGE';
        reject(error);
        req.destroy?.();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('INVALID_JSON');
        error.code = 'INVALID_JSON';
        reject(error);
      }
    });

    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function cleanupTextDedupe(now = Date.now()) {
  for (const [key, expiresAt] of processedTextMessageIds.entries()) {
    if (expiresAt <= now) processedTextMessageIds.delete(key);
  }
}

function acquireTextMessage(key, now = Date.now()) {
  const normalized = String(key || '').trim();
  if (!normalized) return true;
  cleanupTextDedupe(now);
  if (processedTextMessageIds.has(normalized)) return false;
  processedTextMessageIds.set(normalized, now + DEDUPE_TTL_MS);
  return true;
}

function releaseTextMessage(key) {
  const normalized = String(key || '').trim();
  if (normalized) processedTextMessageIds.delete(normalized);
}

function clearWahaWebhookV2Dedupe() {
  processedTextMessageIds.clear();
}

function ignoredReason(incoming) {
  if (incoming.event && !['message', 'message.any'].includes(incoming.event)) return 'EVENT_NOT_MESSAGE';
  if (incoming.fromMe) return 'FROM_ME';
  if (incoming.isGroup) return 'GROUP_MESSAGE';
  if (incoming.isBroadcast) return 'BROADCAST_MESSAGE';
  if (!incoming.chatId || !incoming.senderRaw) return 'MESSAGE_INCOMPLETE';
  return '';
}

async function handleVoice({ event, sendJson, res, dependencies }) {
  const reason = ignoredReason(event);
  if (reason) {
    sendJson(res, 200, { ok: true, ignored: true, reason });
    return true;
  }

  try {
    const result = await (dependencies.runVoicePipelineV2 || runVoicePipelineV2)(event, dependencies.voicePipelineDependencies || dependencies);
    if (result.duplicate) {
      sendJson(res, 200, { ok: true, ignored: true, reason: 'DUPLICATE_MESSAGE' });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      processed: true,
      replySent: Boolean(result.replySent),
      replyType: result.replyType || null,
      transcribed: true,
      pipeline: 'voice-v2'
    });
  } catch (error) {
    const delivery = dependencies.delivery || createWahaDeliveryAdapter({
      env: { ...process.env, WAHA_SESSION: event.session }
    });
    const transcriptionCodes = new Set([
      'VOICE_TRANSCRIPTION_EMPTY',
      'CONNECT_TRANSCRIPTION_EMPTY',
      'CONNECT_VOICE_REQUEST_FAILED',
      'VOICE_MIME_UNSUPPORTED',
      'CONNECT_AUDIO_REQUIRED'
    ]);
    const fallbackText = transcriptionCodes.has(error.code)
      ? 'No pude escuchar correctamente la nota de voz. Podés enviarla nuevamente o escribirme el mensaje.'
      : 'Tuve un problema procesando el audio. Podés escribirme el mensaje mientras lo intento nuevamente.';

    try {
      await delivery.sendText({ chatId: event.chatId, text: fallbackText });
    } catch (deliveryError) {
      console.error('[VOICE_PIPELINE_V2_FALLBACK_FAILED]', {
        correlationId: event.messageId ? 'present' : 'missing',
        code: deliveryError.code || 'VOICE_DELIVERY_FAILED'
      });
    }

    sendJson(res, 200, {
      ok: false,
      processed: false,
      code: error.code || 'VOICE_PIPELINE_V2_FAILED',
      pipeline: 'voice-v2'
    });
  }
  return true;
}

async function handleText({ body, sendJson, res, dependencies }) {
  const incoming = extractIncoming(body);
  const reason = ignoredReason(incoming);
  if (reason) {
    sendJson(res, 200, { ok: true, ignored: true, reason });
    return true;
  }
  if (incoming.messageType !== 'text' || !incoming.text) {
    sendJson(res, 200, { ok: true, ignored: true, reason: 'MESSAGE_INCOMPLETE' });
    return true;
  }

  const dedupeKey = incoming.messageId || `${incoming.session}:${incoming.chatId}:text:${incoming.text}`;
  if (!acquireTextMessage(dedupeKey)) {
    sendJson(res, 200, { ok: true, ignored: true, reason: 'DUPLICATE_MESSAGE' });
    return true;
  }

  try {
    const processMessageImpl = dependencies.processMessage || processMessage;
    const result = await processMessageImpl({
      message: incoming.text,
      platform: process.env.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL',
      channel: 'whatsapp',
      externalUserId: incoming.senderRaw,
      phone: normalizePhone(incoming.phone || incoming.senderRaw),
      metadata: {
        source: 'waha',
        pipeline: 'text-v1-preserved',
        session: incoming.session,
        messageId: incoming.messageId || null,
        chatId: incoming.chatId,
        event: incoming.event || 'message',
        senderRaw: incoming.senderRaw,
        messageType: 'text',
        originalText: incoming.text
      }
    });
    const reply = String(result?.reply || '').trim();
    if (!reply) {
      const error = new Error('ORCHESTRATOR_REPLY_EMPTY');
      error.code = 'ORCHESTRATOR_REPLY_EMPTY';
      throw error;
    }

    if (dependencies.sendWahaText) {
      await dependencies.sendWahaText({ session: incoming.session, chatId: incoming.chatId, text: reply });
    } else {
      const delivery = dependencies.delivery || createWahaDeliveryAdapter({
        env: { ...process.env, WAHA_SESSION: incoming.session }
      });
      await delivery.sendText({ chatId: incoming.chatId, text: reply });
    }

    sendJson(res, 200, {
      ok: true,
      processed: true,
      replySent: true,
      replyType: 'text',
      transcribed: false,
      ownerMode: Boolean(result?.context?.ownerMode),
      platform: result?.context?.platform || null,
      pipeline: 'text-v1-preserved'
    });
  } catch (error) {
    releaseTextMessage(dedupeKey);
    sendJson(res, 200, {
      ok: false,
      processed: false,
      code: error.code || 'WAHA_TEXT_PIPELINE_FAILED'
    });
  }

  return true;
}

async function handleWahaWebhookApiV2({ req, res, sendJson, dependencies = {} }) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname !== '/webhook/inbound') return false;

  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'ELANKAV WAHA Inbound Bridge',
      status: 'READY',
      version: 'VOICE-PIPELINE-V2'
    });
    return true;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { ok: false, error: 'Método no permitido' });
    return true;
  }

  try {
    const body = await readJsonBody(req);
    const voiceEvent = normalizeWahaVoiceEvent(body);
    if (voiceEvent) return handleVoice({ event: voiceEvent, sendJson, res, dependencies });
    return handleText({ body, sendJson, res, dependencies });
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      processed: false,
      code: error.code || 'WAHA_WEBHOOK_V2_INVALID_REQUEST'
    });
    return true;
  }
}

module.exports = {
  clearWahaWebhookV2Dedupe,
  handleWahaWebhookApi: handleWahaWebhookApiV2,
  handleWahaWebhookApiV2,
  readJsonBody
};