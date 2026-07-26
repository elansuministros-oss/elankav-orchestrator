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

function extractMediaReference(payload = {}) {
  const media = payload.media && typeof payload.media === 'object'
    ? payload.media
    : null;
  const url = String(
    media?.url ||
    payload.mediaUrl ||
    payload._data?.media?.url ||
    ''
  ).trim();
  const mimetype = String(
    media?.mimetype ||
    payload.mimetype ||
    payload._data?.mimetype ||
    ''
  ).trim();
  const filename = String(
    media?.filename ||
    payload.filename ||
    payload._data?.filename ||
    ''
  ).trim();
  const hasMedia = Boolean(
    payload.hasMedia ||
    media ||
    url ||
    mimetype
  );

  if (!hasMedia) return null;

  return Object.freeze({
    type: mimetype.startsWith('image/')
      ? 'image'
      : mimetype === 'application/pdf'
        ? 'document'
        : 'media',
    url: url || null,
    mimetype: mimetype || null,
    filename: filename || null,
    source: 'waha',
    available: Boolean(url),
    error: media?.error || null
  });
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
  const media = extractMediaReference(payload);

  return {
    event,
    session: body.session || payload.session || process.env.WAHA_SESSION || 'default',
    senderRaw,
    phone: normalizePhone(senderRaw),
    chatId,
    text: extractText(payload),
    media,
    hasMedia: Boolean(media),
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

    if (!incoming.chatId || !incoming.senderRaw || (!incoming.text && !incoming.hasMedia)) {
      sendJson(res, 200, { ok: true, ignored: true, reason: 'MESSAGE_INCOMPLETE' });
      return true;
    }

    if (incoming.hasMedia && !incoming.media?.available) {
      sendJson(res, 200, {
        ok: false,
        processed: false,
        error: 'WAHA detectó el archivo, pero no entregó una URL descargable.',
        code: 'WAHA_MEDIA_NOT_AVAILABLE'
      });
      return true;
    }

    console.log('[WAHA_INBOUND_RECEIVED]', {
      event: incoming.event || 'message',
      session: incoming.session,
      senderRaw: incoming.senderRaw,
      phone: incoming.phone,
      hasMedia: incoming.hasMedia,
      mediaType: incoming.media?.mimetype || null
    });

    const references = incoming.media ? [incoming.media] : [];
    const message = incoming.text || (
      incoming.media?.type === 'image'
        ? 'Analizá esta imagen y ayudame con la solicitud asociada.'
        : 'Analizá este archivo y ayudame con la solicitud asociada.'
    );

    const result = await processMessageImpl({
      message,
      platform: process.env.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL',
      channel: 'whatsapp',
      externalUserId: incoming.senderRaw,
      phone: incoming.phone,
      metadata: {
        source: 'waha',
        session: incoming.session,
        event: incoming.event || 'message',
        senderRaw: incoming.senderRaw,
        references,
        media: incoming.media,
        hasMedia: incoming.hasMedia
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
      references: references.length
    });

    sendJson(res, 200, {
      ok: true,
      processed: true,
      replySent: true,
      mediaAccepted: incoming.hasMedia,
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
  extractMediaReference,
  handleWahaWebhookApi,
  normalizePhone,
  sendWahaText
};