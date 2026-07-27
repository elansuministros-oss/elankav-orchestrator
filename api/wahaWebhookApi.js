const { processMessage } = require('../services/messageService');

const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const MAX_BODY_BYTES = 1024 * 1024;

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

function extractPayload(body = {}) {
  return body.payload && typeof body.payload === 'object'
    ? body.payload
    : body;
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
  const explicitType = String(
    payload.type ||
    payload.messageType ||
    payload._data?.type ||
    payload._data?.messageType ||
    ''
  ).toLowerCase();

  const typeMap = {
    chat: 'text',
    text: 'text',
    ptt: 'audio',
    audio: 'audio',
    voice: 'audio',
    image: 'image',
    video: 'video',
    document: 'document',
    location: 'location',
    vcard: 'contact',
    contact: 'contact',
    sticker: 'sticker'
  };

  if (typeMap[explicitType]) return typeMap[explicitType];

  const message = payload.message || {};
  if (message.audioMessage) return 'audio';
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.documentMessage) return 'document';
  if (message.locationMessage || message.liveLocationMessage) return 'location';
  if (message.contactMessage || message.contactsArrayMessage) return 'contact';
  if (message.stickerMessage) return 'sticker';
  if (extractText(payload)) return 'text';

  return 'unknown';
}

function extractReferral(payload = {}) {
  const referral = payload.referral || payload._data?.referral || payload.message?.referral || null;
  if (!referral || typeof referral !== 'object') return null;

  const sourceUrl = String(referral.sourceUrl || referral.source_url || '').trim() || null;
  const sourceId = String(referral.sourceId || referral.source_id || '').trim() || null;
  const sourceType = String(referral.sourceType || referral.source_type || '').trim() || null;
  const headline = String(referral.headline || referral.title || '').trim() || null;
  const body = String(referral.body || referral.description || '').trim() || null;
  const mediaType = String(referral.mediaType || referral.media_type || '').trim() || null;

  return {
    sourceUrl,
    sourceId,
    sourceType,
    headline,
    body,
    mediaType
  };
}

function classifySource(referral) {
  if (!referral) return 'organic_whatsapp';

  const haystack = [
    referral.sourceUrl,
    referral.sourceType,
    referral.headline,
    referral.body
  ].filter(Boolean).join(' ').toLowerCase();

  if (haystack.includes('instagram')) return 'instagram_ads';
  if (haystack.includes('facebook') || referral.sourceId) return 'facebook_ads';
  return 'click_to_whatsapp';
}

function resolvePlatformHint({ text, referral } = {}) {
  const haystack = [
    referral?.sourceUrl,
    referral?.headline,
    referral?.body,
    text
  ].filter(Boolean).join(' ').toLowerCase();

  if (/elan\s*home|inmueble|casa|apartamento|propiedad/.test(haystack)) return 'elanhome';
  if (/elan\s*pet|mascota|perro|gato|veterin/.test(haystack)) return 'elanpet';
  if (/elan\s*visual|r[oó]tulo|fachada|vinil|acm|letra[s]? 3d|caja de luz/.test(haystack)) return 'elanvisual';
  return null;
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
  const text = extractText(payload);
  const messageType = extractMessageType(payload);
  const referral = extractReferral(payload);
  const sourceOrigin = classifySource(referral);
  const platformHint = resolvePlatformHint({ text, referral });

  return {
    event,
    session: body.session || payload.session || process.env.WAHA_SESSION || 'default',
    senderRaw,
    phone: normalizePhone(senderRaw),
    chatId,
    text,
    messageType,
    referral,
    sourceOrigin,
    platformHint,
    fromMe,
    isGroup: chatId.includes('@g.us'),
    isBroadcast: chatId.includes('status@broadcast')
  };
}

async function sendWahaText({ session, chatId, text, fetchImpl = fetch }) {
  const baseUrl = String(process.env.WAHA_BASE_URL || DEFAULT_WAHA_BASE_URL)
    .replace(/\/+$/, '');
  const apiKey = process.env.WAHA_API_KEY || process.env.WAHA_API_TOKEN || '';
  const headers = { 'Content-Type': 'application/json' };

  if (apiKey) headers['X-Api-Key'] = apiKey;

  const response = await fetchImpl(`${baseUrl}/api/sendText`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ session, chatId, text })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      data?.message || data?.error || `WAHA HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

async function handleWahaWebhookApi({ req, res, sendJson, dependencies = {} }) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname !== '/webhook/inbound') return false;

  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'ELANKAV WAHA Inbound Bridge',
      status: 'READY',
      version: 'ORCH-WAHA-INBOUND-02'
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

    console.log('[WAHA_INBOUND_RECEIVED]', {
      event: incoming.event || 'message',
      session: incoming.session,
      senderRaw: incoming.senderRaw,
      phone: incoming.phone,
      messageType: incoming.messageType,
      sourceOrigin: incoming.sourceOrigin,
      platformHint: incoming.platformHint
    });

    const normalizedMessage = incoming.text || `[${incoming.messageType} recibido por WhatsApp]`;
    const result = await processMessageImpl({
      message: normalizedMessage,
      platform: incoming.platformHint || undefined,
      channel: 'whatsapp',
      externalUserId: incoming.senderRaw,
      phone: incoming.phone,
      metadata: {
        source: 'waha',
        sourceOrigin: incoming.sourceOrigin,
        session: incoming.session,
        event: incoming.event || 'message',
        senderRaw: incoming.senderRaw,
        messageType: incoming.messageType,
        referral: incoming.referral,
        sourcePlatform: incoming.platformHint
      }
    });

    const reply = String(result?.reply || '').trim();
    if (!reply) throw new Error('Orchestrator respondió sin texto');

    await sendWahaTextImpl({
      session: incoming.session,
      chatId: incoming.chatId,
      text: reply
    });

    console.log('[WAHA_REPLY_SENT]', {
      session: incoming.session,
      chatId: incoming.chatId,
      ownerMode: Boolean(result?.context?.ownerMode),
      model: result?.model || null,
      messageType: incoming.messageType,
      sourceOrigin: incoming.sourceOrigin
    });

    sendJson(res, 200, {
      ok: true,
      processed: true,
      replySent: true,
      ownerMode: Boolean(result?.context?.ownerMode),
      platform: result?.context?.platform || incoming.platformHint || null,
      messageType: incoming.messageType,
      sourceOrigin: incoming.sourceOrigin
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
  classifySource,
  extractIncoming,
  extractMessageType,
  extractReferral,
  handleWahaWebhookApi,
  normalizePhone,
  resolvePlatformHint,
  sendWahaText
};