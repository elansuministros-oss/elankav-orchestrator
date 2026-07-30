'use strict';

const { processMessage } = require('../services/messageService');
const {
  downloadWahaMedia,
  resolveAudioMimeType,
  synthesizeSpeech,
  transcribeAudio
} = require('../services/connectVoiceService');
const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');

const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_OWNER_PHONE = '50588388940';
const DEDUPE_TTL_MS = 10 * 60 * 1000;
const processedMessageIds = new Map();
const TRANSCRIPTION_FAILURE_TEXT = 'No pude escuchar correctamente la nota de voz. Podés enviarla nuevamente o escribirme el mensaje.';
const INTERNAL_AUDIO_FAILURE_TEXT = 'Tuve un problema procesando el audio. Podés escribirme el mensaje mientras lo intento nuevamente.';
const PRESENTATION_TEXT = process.env.ELAN_AI_PRESENTATION_TEXT || [
  'Hola, soy ELAN IA, el asistente inteligente del ecosistema ELANKAV.',
  'Puedo ayudarte con información, cotizaciones, diseño, seguimiento de proyectos y servicios disponibles en ELANVISUAL, ELANHOME y ELANPET.',
  'También apoyo a Erick Cano en tareas operativas autorizadas mediante el Orchestrator y ELANKAV CONNECT.',
  'Decime qué necesitás y comenzamos.'
].join(' ');

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
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
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
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', error => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function normalizePhone(value) {
  const raw = String(value || '')
    .split('@')[0]
    .replace(/\D/g, '');
  if (!raw) return '';
  return raw.length === 8 ? `505${raw}` : raw;
}

function getOwnerPhones() {
  const configured = String(
    process.env.ORCHESTRATOR_OWNER_PHONES ||
    process.env.ORCHESTRATOR_OWNER_PHONE ||
    ''
  )
    .split(',')
    .map(normalizePhone)
    .filter(Boolean);
  return configured.length ? configured : [DEFAULT_OWNER_PHONE];
}

function isOwnerPhone(phone) {
  return Boolean(phone && getOwnerPhones().includes(normalizePhone(phone)));
}

function isPresentationAudioRequest(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return normalized === '/demo bienvenida'
    || normalized === '/demo audio'
    || /(?:env[ií]ame|manda(?:me)?|quiero|muestra).*audio.*presentaci[oó]n/.test(normalized)
    || /(?:pres[eé]ntate|bienvenida).*(?:audio|voz)/.test(normalized);
}

function extractPayload(body = {}) {
  return body.payload && typeof body.payload === 'object' ? body.payload : body;
}

function maskChatId(chatId = '') {
  const value = String(chatId || '');
  if (value.length <= 8) return value ? '***' : '';
  return `${value.slice(0, 4)}***${value.slice(-8)}`;
}

function logVoiceEvent(event, data = {}) {
  console.log(`[${event}]`, {
    eventId: data.eventId || null,
    messageId: data.messageId || null,
    session: data.session || null,
    chatId: data.chatId ? maskChatId(data.chatId) : null,
    messageType: data.messageType || null,
    mimeType: data.mimeType || null,
    status: data.status || null,
    durationMs: data.durationMs || null,
    errorCode: data.errorCode || null
  });
}

function cleanupDedupe(now = Date.now()) {
  for (const [key, expiresAt] of processedMessageIds.entries()) {
    if (expiresAt <= now) processedMessageIds.delete(key);
  }
}

function markMessageOnce(messageId, now = Date.now()) {
  const key = String(messageId || '').trim();
  if (!key) return true;
  cleanupDedupe(now);
  if (processedMessageIds.has(key)) return false;
  processedMessageIds.set(key, now + DEDUPE_TTL_MS);
  return true;
}

function clearWahaInboundDedupe() {
  processedMessageIds.clear();
}

function extractMessageId(payload = {}, body = {}) {
  return String(
    body.id ||
    body.eventId ||
    body.messageId ||
    payload.id?.id ||
    payload.id ||
    payload.messageId ||
    payload.key?.id ||
    payload._data?.id?.id ||
    payload.message?.key?.id ||
    ''
  ).trim();
}

function extractSenderRaw(payload = {}) {
  const candidates = [
    payload.from,
    payload.author,
    payload.participant,
    payload.sender,
    payload.chatId,
    payload.key?.remoteJid,
    payload.key?.participant,
    payload.id?.remote,
    payload.id?.participant,
    payload._data?.from,
    payload._data?.author,
    payload._data?.participant,
    payload._data?.id?.remote,
    payload._data?.id?.participant,
    payload.message?.key?.remoteJid,
    payload.message?.key?.participant
  ].filter(Boolean);

  return String(
    candidates.find(value => {
      const candidate = String(value);
      return candidate.includes('@c.us') || candidate.includes('@lid');
    }) || candidates[0] || ''
  );
}

function extractText(payload = {}) {
  return String(
    payload.body ||
    payload.text ||
    payload.caption ||
    payload.message?.conversation ||
    payload.message?.extendedTextMessage?.text ||
    payload.message?.imageMessage?.caption ||
    payload.message?.videoMessage?.caption ||
    payload._data?.body ||
    payload._data?.caption ||
    ''
  ).trim();
}

function extractMessageType(payload = {}) {
  const explicit = String(
    payload.type || payload.messageType || payload._data?.type || ''
  ).toLowerCase();
  if (['ptt', 'audio', 'voice'].includes(explicit)) return 'audio';
  if (payload.message?.audioMessage) return 'audio';
  const media = payload.media || payload._data?.media || null;
  const mimeType = String(
    payload.mimetype ||
    payload.mimeType ||
    payload.message?.mimetype ||
    payload.message?.mimeType ||
    payload._data?.mimetype ||
    payload._data?.mimeType ||
    (media && typeof media === 'object' ? media.mimetype || media.mimeType : '') ||
    ''
  ).toLowerCase();
  if (mimeType.startsWith('audio/')) return 'audio';
  if (extractText(payload)) return 'text';
  return 'unknown';
}

function extractMedia(payload = {}) {
  const media = payload.media || payload._data?.media || null;
  const url = String(
    payload.mediaUrl ||
    payload.downloadUrl ||
    payload.url ||
    payload.message?.mediaUrl ||
    payload._data?.mediaUrl ||
    (media && typeof media === 'object' ? media.url : '') ||
    ''
  ).trim();
  if (!url) return null;
  return {
    url,
    mimeType: String(
      payload.mimetype ||
      payload.mimeType ||
      payload.message?.mimetype ||
      payload.message?.mimeType ||
      payload._data?.mimetype ||
      payload._data?.mimeType ||
      (media && typeof media === 'object' ? media.mimetype || media.mimeType : '') ||
      'audio/ogg'
    ),
    filename: String(
      payload.filename ||
      payload.message?.filename ||
      (media && typeof media === 'object' ? media.filename : '') ||
      'voice.ogg'
    )
  };
}

function extractIncoming(body = {}) {
  const payload = extractPayload(body);
  const senderRaw = extractSenderRaw(payload);
  const event = String(body.event || payload.event || '').toLowerCase();
  const fromMe = Boolean(
    payload.fromMe ??
    payload.key?.fromMe ??
    payload.id?.fromMe ??
    payload._data?.id?.fromMe ??
    false
  );
  const chatId = String(
    payload.from ||
    payload.chatId ||
    payload.key?.remoteJid ||
    payload._data?.from ||
    senderRaw ||
    ''
  );

  return {
    event,
    messageId: extractMessageId(payload, body),
    session: body.session || payload.session || process.env.WAHA_SESSION || 'default',
    senderRaw,
    phone: normalizePhone(senderRaw),
    chatId,
    text: extractText(payload),
    messageType: extractMessageType(payload),
    media: extractMedia(payload),
    fromMe,
    isGroup: chatId.includes('@g.us'),
    isBroadcast: chatId.includes('status@broadcast')
  };
}

async function sendWahaRequest(path, body, fetchImpl = fetch) {
  const baseUrl = String(process.env.WAHA_BASE_URL || DEFAULT_WAHA_BASE_URL).replace(/\/+$/, '');
  const apiKey = process.env.WAHA_API_KEY || process.env.WAHA_API_TOKEN || '';
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `WAHA HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function sendWahaText({ session, chatId, text, fetchImpl = fetch }) {
  const delivery = createWahaDeliveryAdapter({
    env: { ...process.env, WAHA_SESSION: session || process.env.WAHA_SESSION },
    fetchImpl
  });
  return delivery.sendText({ chatId, text });
}

async function sendWahaVoice({ session, chatId, data, mimeType, fetchImpl = fetch }) {
  const delivery = createWahaDeliveryAdapter({
    env: { ...process.env, WAHA_SESSION: session || process.env.WAHA_SESSION },
    fetchImpl
  });
  return delivery.sendVoice({ chatId, data, mimeType: mimeType || 'audio/ogg' });
}

async function resolveIncomingMessage(incoming, dependencies = {}) {
  if (incoming.messageType !== 'audio') return incoming.text;
  if (!incoming.media?.url) {
    const error = new Error('WAHA_AUDIO_MEDIA_URL_MISSING');
    error.code = 'WAHA_AUDIO_MEDIA_URL_MISSING';
    throw error;
  }

  const downloadMediaImpl = dependencies.downloadWahaMedia || downloadWahaMedia;
  const transcribeImpl = dependencies.transcribeAudio || transcribeAudio;
  logVoiceEvent('VOICE_MEDIA_DOWNLOAD_STARTED', incoming);
  const media = await downloadMediaImpl({ url: incoming.media.url });
  logVoiceEvent('VOICE_MEDIA_DOWNLOADED', {
    ...incoming,
    mimeType: media.mimeType,
    status: 'OK'
  });
  const mimeType = resolveAudioMimeType({
    downloadedMimeType: media.mimeType,
    webhookMimeType: incoming.media.mimeType
  });
  logVoiceEvent('VOICE_MIME_NORMALIZED', {
    ...incoming,
    mimeType
  });
  logVoiceEvent('VOICE_TRANSCRIPTION_STARTED', {
    ...incoming,
    mimeType
  });
  const text = await transcribeImpl({
    audio: media.buffer,
    mimeType,
    filename: incoming.media.filename
  });
  logVoiceEvent('VOICE_TRANSCRIPTION_COMPLETED', incoming);
  return text;
}

async function handleWahaWebhookApi({ req, res, sendJson, dependencies = {} }) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname !== '/webhook/inbound') return false;

  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'ELANKAV WAHA Inbound Bridge',
      status: 'READY',
      version: 'ORCH-WAHA-INBOUND-VOICE-01'
    });
    return true;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { ok: false, error: 'Método no permitido' });
    return true;
  }

  const processMessageImpl = dependencies.processMessage || processMessage;
  const sendWahaTextImpl = dependencies.sendWahaText || sendWahaText;
  const sendWahaVoiceImpl = dependencies.sendWahaVoice || sendWahaVoice;
  const synthesizeImpl = dependencies.synthesizeSpeech || synthesizeSpeech;
  let incoming = null;

  try {
    const body = await readJsonBody(req);
    incoming = extractIncoming(body);

    if (incoming.event && !['message', 'message.any'].includes(incoming.event)) {
      sendJson(res, 200, { ok: true, ignored: true, reason: 'EVENT_NOT_MESSAGE' });
      return true;
    }
    if (incoming.fromMe) {
      sendJson(res, 200, { ok: true, ignored: true, reason: 'FROM_ME' });
      return true;
    }
    if (incoming.isGroup || incoming.isBroadcast) {
      sendJson(res, 200, {
        ok: true,
        ignored: true,
        reason: incoming.isGroup ? 'GROUP_MESSAGE' : 'BROADCAST_MESSAGE'
      });
      return true;
    }
    if (!incoming.chatId || !incoming.senderRaw || incoming.messageType === 'unknown') {
      sendJson(res, 200, { ok: true, ignored: true, reason: 'MESSAGE_INCOMPLETE' });
      return true;
    }
    if (!markMessageOnce(incoming.messageId || `${incoming.session}:${incoming.chatId}:${incoming.messageType}:${incoming.media?.url || incoming.text}`)) {
      logVoiceEvent('VOICE_DUPLICATE_SKIPPED', incoming);
      sendJson(res, 200, { ok: true, ignored: true, reason: 'DUPLICATE_MESSAGE' });
      return true;
    }

    if (incoming.messageType === 'audio') {
      logVoiceEvent('VOICE_INBOUND_RECEIVED', {
        ...incoming,
        mimeType: incoming.media?.mimeType || null
      });
    }
    const resolvedMessage = await resolveIncomingMessage(incoming, dependencies);
    if (!resolvedMessage) throw new Error('MESSAGE_TRANSCRIPTION_EMPTY');

    console.log('[WAHA_INBOUND_ACCEPTED]', {
      event: incoming.event || 'message',
      session: incoming.session,
      chatId: maskChatId(incoming.chatId),
      messageType: incoming.messageType,
      transcribed: incoming.messageType === 'audio',
      mediaUrlPresent: Boolean(incoming.media?.url),
      mimeType: incoming.media?.mimeType || null
    });

    if (isOwnerPhone(incoming.phone) && isPresentationAudioRequest(resolvedMessage)) {
      const speech = await synthesizeImpl({ text: PRESENTATION_TEXT });
      await sendWahaVoiceImpl({
        session: incoming.session,
        chatId: incoming.chatId,
        data: speech.data,
        mimeType: speech.mimeType
      });
      sendJson(res, 200, {
        ok: true,
        processed: true,
        replySent: true,
        replyType: 'voice',
        ownerMode: true,
        presentationDemo: true
      });
      return true;
    }

    logVoiceEvent('VOICE_AI_STARTED', incoming);
    const result = await processMessageImpl({
      message: resolvedMessage,
      platform: process.env.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL',
      channel: 'whatsapp',
      externalUserId: incoming.senderRaw,
      phone: incoming.phone,
      metadata: {
        source: 'waha',
        session: incoming.session,
        messageId: incoming.messageId || null,
        chatId: incoming.chatId,
        event: incoming.event || 'message',
        senderRaw: incoming.senderRaw,
        messageType: incoming.messageType,
        originalText: incoming.text || null,
        transcribedText: incoming.messageType === 'audio' ? resolvedMessage : null
      }
    });
    logVoiceEvent('VOICE_AI_COMPLETED', incoming);

    const reply = String(result?.reply || '').trim();
    if (!reply) throw new Error('Orchestrator respondió sin texto');

    let replyType = 'text';
    if (incoming.messageType === 'audio') {
      try {
        logVoiceEvent('VOICE_SPEECH_STARTED', incoming);
        const speech = await synthesizeImpl({ text: reply });
        logVoiceEvent('VOICE_SPEECH_COMPLETED', {
          ...incoming,
          mimeType: speech.mimeType
        });
        await sendWahaVoiceImpl({
          session: incoming.session,
          chatId: incoming.chatId,
          data: speech.data,
          mimeType: speech.mimeType
        });
        replyType = 'voice';
        logVoiceEvent('VOICE_REPLY_SENT', incoming);
      } catch (voiceError) {
        console.error('[WAHA_VOICE_REPLY_FALLBACK]', {
          message: voiceError.message,
          code: voiceError.code || null,
          status: voiceError.status || null
        });
        await sendWahaTextImpl({ session: incoming.session, chatId: incoming.chatId, text: reply });
        logVoiceEvent('VOICE_TEXT_FALLBACK_SENT', {
          ...incoming,
          errorCode: voiceError.code || 'VOICE_SPEECH_FAILED',
          status: voiceError.status || null
        });
      }
    } else {
      await sendWahaTextImpl({ session: incoming.session, chatId: incoming.chatId, text: reply });
    }

    console.log('[WAHA_REPLY_SENT]', {
      session: incoming.session,
      chatId: maskChatId(incoming.chatId),
      ownerMode: Boolean(result?.context?.ownerMode),
      model: result?.model || null,
      replyType
    });

    sendJson(res, 200, {
      ok: true,
      processed: true,
      replySent: true,
      replyType,
      transcribed: incoming.messageType === 'audio',
      ownerMode: Boolean(result?.context?.ownerMode),
      platform: result?.context?.platform || null
    });
  } catch (error) {
    console.error('[WAHA_INBOUND_ERROR]', {
      message: error.message,
      code: error.code || null,
      status: error.status || null
    });
    try {
      if (incoming?.messageType === 'audio' && incoming.chatId) {
        const isTranscriptionFailure = [
          'VOICE_TRANSCRIPTION_EMPTY',
          'CONNECT_TRANSCRIPTION_EMPTY',
          'CONNECT_VOICE_REQUEST_FAILED',
          'VOICE_MIME_UNSUPPORTED',
          'CONNECT_AUDIO_REQUIRED'
        ].includes(error.code);
        await sendWahaTextImpl({
          session: incoming.session,
          chatId: incoming.chatId,
          text: isTranscriptionFailure ? TRANSCRIPTION_FAILURE_TEXT : INTERNAL_AUDIO_FAILURE_TEXT
        });
        logVoiceEvent('VOICE_TEXT_FALLBACK_SENT', {
          ...incoming,
          errorCode: error.code || 'VOICE_PIPELINE_ERROR',
          status: error.status || null
        });
      }
    } catch (fallbackError) {
      logVoiceEvent('VOICE_PIPELINE_ERROR', {
        errorCode: fallbackError.code || 'VOICE_DELIVERY_FAILED',
        status: fallbackError.status || null
      });
    }
    sendJson(res, 200, {
      ok: false,
      processed: false,
      error: error.message,
      code: error.code || null
    });
  }

  return true;
}

module.exports = {
  extractIncoming,
  extractMedia,
  extractMessageType,
  clearWahaInboundDedupe,
  handleWahaWebhookApi,
  isPresentationAudioRequest,
  normalizePhone,
  resolveIncomingMessage,
  sendWahaText,
  sendWahaVoice
};
