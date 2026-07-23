'use strict';

const { processMessage } = require('../services/messageService');
const {
  createWahaDeliveryAdapter,
  normalizePhone
} = require('../adapters/wahaDeliveryAdapter');

const WEBHOOK_PATHS = new Set([
  '/webhook/inbound',
  '/api/waha/webhook'
]);
const MAX_BODY_BYTES = 256 * 1024;
const DEDUPE_TTL_MS = 10 * 60 * 1000;
const processedEvents = new Map();

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
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!body.trim()) {
        reject(Object.assign(new Error('BODY_REQUIRED'), { code: 'BODY_REQUIRED' }));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('INVALID_JSON'), { code: 'INVALID_JSON' }));
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

function getPathname(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
}

function isAuthorized(req, env = process.env) {
  const expected = String(env.WAHA_WEBHOOK_TOKEN || '').trim();
  if (!expected) return true;

  const authorization = String(req.headers.authorization || '').trim();
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const supplied = String(
    req.headers['x-waha-token'] ||
    req.headers['x-webhook-token'] ||
    bearer
  ).trim();

  return supplied === expected;
}

function extractText(payload = {}) {
  const message = payload.payload || payload.message || payload.data || {};
  return String(
    message.body ??
    message.text?.body ??
    message.text ??
    message.caption ??
    payload.body ??
    ''
  ).trim();
}

function extractChatId(payload = {}) {
  const message = payload.payload || payload.message || payload.data || {};
  return String(
    message.from ??
    message.chatId ??
    message.key?.remoteJid ??
    payload.from ??
    payload.chatId ??
    ''
  ).trim();
}

function extractEventId(payload = {}) {
  const message = payload.payload || payload.message || payload.data || {};
  return String(
    message.id?._serialized ??
    message.id?.id ??
    message.id ??
    message.key?.id ??
    payload.id ??
    ''
  ).trim();
}

function isOwnMessage(payload = {}) {
  const message = payload.payload || payload.message || payload.data || {};
  return message.fromMe === true || message.key?.fromMe === true;
}

function isMessageEvent(payload = {}) {
  const event = String(payload.event || payload.type || '').toLowerCase();
  return !event || event === 'message' || event === 'message.any' || event === 'message.received';
}

function cleanupDedupe(now = Date.now()) {
  for (const [key, timestamp] of processedEvents.entries()) {
    if (now - timestamp > DEDUPE_TTL_MS) processedEvents.delete(key);
  }
}

function claimEvent(eventId, now = Date.now()) {
  if (!eventId) return true;
  cleanupDedupe(now);
  if (processedEvents.has(eventId)) return false;
  processedEvents.set(eventId, now);
  return true;
}

function normalizeInbound(payload = {}) {
  const chatId = extractChatId(payload);
  const phone = normalizePhone(chatId);
  const text = extractText(payload);
  const eventId = extractEventId(payload);
  const session = String(payload.session || payload.payload?.session || '').trim() || null;

  return {
    chatId,
    phone,
    text,
    eventId,
    session,
    platform: String(payload.platform || process.env.ELANKAV_DEFAULT_PLATFORM || 'elanvisual').trim(),
    event: String(payload.event || payload.type || 'message').trim()
  };
}

async function handleWahaWebhookApi({
  req,
  res,
  sendJson,
  processMessageFn = processMessage,
  delivery = createWahaDeliveryAdapter(),
  env = process.env
}) {
  const pathname = getPathname(req);
  if (!WEBHOOK_PATHS.has(pathname)) return false;

  if (req.method === 'GET') {
    sendJson(res, 200, {
      success: true,
      service: 'ELANKAV WAHA inbound webhook',
      status: 'READY'
    });
    return true;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { success: false, error: 'Método no permitido' });
    return true;
  }

  if (!isAuthorized(req, env)) {
    sendJson(res, 401, { success: false, error: 'Webhook no autorizado' });
    return true;
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    sendJson(res, 415, { success: false, error: 'Content-Type debe ser application/json' });
    return true;
  }

  try {
    const payload = await readJsonBody(req);

    if (!isMessageEvent(payload) || isOwnMessage(payload)) {
      sendJson(res, 202, { success: true, ignored: true, reason: 'EVENT_NOT_ACTIONABLE' });
      return true;
    }

    const inbound = normalizeInbound(payload);
    if (!inbound.text || !inbound.chatId || !inbound.phone) {
      sendJson(res, 202, { success: true, ignored: true, reason: 'MESSAGE_DATA_INCOMPLETE' });
      return true;
    }

    if (!claimEvent(inbound.eventId)) {
      sendJson(res, 200, { success: true, duplicate: true, eventId: inbound.eventId });
      return true;
    }

    const result = await processMessageFn({
      message: inbound.text,
      platform: inbound.platform,
      channel: 'whatsapp',
      externalUserId: inbound.chatId,
      phone: inbound.phone,
      metadata: {
        source: 'waha-webhook',
        eventId: inbound.eventId || null,
        event: inbound.event,
        session: inbound.session,
        chatId: inbound.chatId
      }
    });

    const reply = String(result?.reply || '').trim();
    if (reply) {
      await delivery.sendText({ chatId: inbound.chatId, text: reply });
    }

    sendJson(res, 200, {
      success: true,
      processed: true,
      replied: Boolean(reply),
      eventId: inbound.eventId || null,
      provider: result?.provider || null,
      status: result?.status || null
    });
  } catch (error) {
    const status = error.code === 'PAYLOAD_TOO_LARGE'
      ? 413
      : error.code === 'BODY_REQUIRED' || error.code === 'INVALID_JSON'
        ? 400
        : 502;

    sendJson(res, status, {
      success: false,
      error: status === 502 ? 'No fue posible procesar el mensaje de WAHA' : error.message,
      code: error.code || null,
      detail: status === 502 ? error.message : undefined
    });
  }

  return true;
}

module.exports = {
  WEBHOOK_PATHS,
  claimEvent,
  extractChatId,
  extractEventId,
  extractText,
  handleWahaWebhookApi,
  isAuthorized,
  isMessageEvent,
  isOwnMessage,
  normalizeInbound,
  readJsonBody
};
