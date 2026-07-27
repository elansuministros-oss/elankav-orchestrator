'use strict';

const {
  processCommercialAwareMessage
} = require('../services/commercial/commercialAwareMessageService');
const {
  downloadWahaMedia,
  synthesizeSpeech,
  transcribeAudio
} = require('../services/connectVoiceService');

const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_OWNER_PHONE = '50588388940';
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
  if (extractText(payload)) return 'text';
  return 'unknown';
}

function extractMedia(payload = {}) {
  const media = payload.media || payload._data?.media || null;
  if (!media || typeof media !== 'object') return null;
  const url = String(media.url || '').trim();
  if (!url) return null;
  return {
    url,
    mimeType: String(media.mimetype || media.mimeType || 'audio/ogg'),
    filename: String(media.filename || 'voice.ogg')
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
  return sendWahaRequest('/api/sendText', { session, chatId, text }, fetchImpl);
}

async function sendWahaVoice({ session, chatId, data, mimeType, fetchImpl = fetch }) {
  return sendWahaRequest('/api/sendVoice', {
    session,
    chatId,
    file: {
      mimetype: mimeType || 'audio/ogg; codecs=opus',
      data
    },
    convert: false
  }, fetchImpl);
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
  const media = await downloadMediaImpl({ url: incoming.media.url });
  return transcribeImpl({
    audio: media.buffer,
    mimeType: incoming.media.mimeType || media.mimeType,
    filename: incoming.media.filename
  });
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

  const processMessageImpl = dependencies.processMessage || processCommercialAwareMessage;
  const sendWahaTextImpl = dependencies.sendWahaText || sendWahaText;
  const sendWahaVoiceImpl = dependencies.sendWahaVoice || sendWahaVoice;
  const synthesizeImpl = dependencies.synthesizeSpeech || synthesizeSpeech;

  try {
    const body = await readJsonBody(req);
    const incoming = extractIncoming(body);

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

    const resolvedMessage = await resolveIncomingMessage(incoming, dependencies);
    if (!resolvedMessage) throw new Error('MESSAGE_TRANSCRIPTION_EMPTY');

    console.log('[WAHA_INBOUND_RECEIVED]', {
      event: incoming.event || 'message',
      session: incoming.session,
      senderRaw: incoming.senderRaw,
      phone: incoming.phone,
      messageType: incoming.messageType,
      transcribed: incoming.messageType === 'audio'
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

    const result = await processMessageImpl({
      message: resolvedMessage,
      platform: process.env.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL',
      channel: 'whatsapp',
      externalUserId: incoming.senderRaw,
      phone: incoming.phone,
      metadata: {
        source: 'waha',
        session: incoming.session,
        event: incoming.event || 'message',
        senderRaw: incoming.senderRaw,
        messageType: incoming.messageType,
        originalText: incoming.text || null,
        transcribedText: incoming.messageType === 'audio' ? resolvedMessage : null
      }
    });

    if (result?.shouldReply === false) {
      console.log('[WAHA_REPLY_SUPPRESSED]', {
        session: incoming.session,
        chatId: incoming.chatId,
        suppressionReason: result.suppressionReason || 'REPLY_SUPPRESSED',
        model: result.model || null
      });
      sendJson(res, 200, {
        ok: true,
        processed: true,
        replySent: false,
        replyType: 'suppressed',
        suppressionReason: result.suppressionReason || 'REPLY_SUPPRESSED',
        transcribed: incoming.messageType === 'audio',
        ownerMode: Boolean(result?.context?.ownerMode),
        platform: result?.context?.platform || null
      });
      return true;
    }

    const reply = String(result?.reply || '').trim();
    if (!reply) throw new Error('Orchestrator respondió sin texto');

    let replyType = 'text';
    if (incoming.messageType === 'audio') {
      try {
        const speech = await synthesizeImpl({ text: reply });
        await sendWahaVoiceImpl({
          session: incoming.session,
          chatId: incoming.chatId,
          data: speech.data,
          mimeType: speech.mimeType
        });
        replyType = 'voice';
      } catch (voiceError) {
        console.error('[WAHA_VOICE_REPLY_FALLBACK]', {
          message: voiceError.message,
          code: voiceError.code || null,
          status: voiceError.status || null
        });
        await sendWahaTextImpl({ session: incoming.session, chatId: incoming.chatId, text: reply });
      }
    } else {
      await sendWahaTextImpl({ session: incoming.session, chatId: incoming.chatId, text: reply });
    }

    console.log('[WAHA_REPLY_SENT]', {
      session: incoming.session,
      chatId: incoming.chatId,
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
  handleWahaWebhookApi,
  isPresentationAudioRequest,
  normalizePhone,
  resolveIncomingMessage,
  sendWahaText,
  sendWahaVoice
};