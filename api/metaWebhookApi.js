'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TEXT_LENGTH = 500;

function clean(value) {
  return String(value || '').trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    let settled = false;

    req.on('data', chunk => {
      if (settled) return;
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        settled = true;
        const error = new Error('META_WEBHOOK_PAYLOAD_TOO_LARGE');
        error.code = 'META_WEBHOOK_PAYLOAD_TOO_LARGE';
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function verifySignature({ rawBody, signature, appSecret }) {
  const secret = clean(appSecret);
  const provided = clean(signature);
  if (!secret || !provided.startsWith('sha256=')) return false;

  const expected =
    'sha256=' +
    createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

  return safeEqual(provided, expected);
}

function normalizeMetaMessagingEvents(payload = {}) {
  const object = clean(payload?.object).toLowerCase();
  const channel =
    object === 'instagram'
      ? 'instagram_dm'
      : object === 'page'
        ? 'messenger'
        : 'unknown';

  const events = [];

  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    const accountId = clean(entry?.id);

    for (const item of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const senderId = clean(item?.sender?.id);
      const recipientId = clean(item?.recipient?.id);
      const messageId = clean(item?.message?.mid);
      const isEcho = item?.message?.is_echo === true;
      const text = clean(item?.message?.text).slice(0, MAX_TEXT_LENGTH);

      let eventType = 'unknown';
      if (item?.message) eventType = isEcho ? 'message_echo' : 'message';
      else if (item?.postback) eventType = 'postback';
      else if (item?.reaction) eventType = 'reaction';
      else if (item?.read) eventType = 'read';
      else if (item?.delivery) eventType = 'delivery';
      else if (item?.referral) eventType = 'referral';

      events.push(Object.freeze({
        source: 'meta',
        channel,
        object,
        accountId,
        senderId,
        recipientId,
        messageId: messageId || null,
        text: text || null,
        timestamp: Number(item?.timestamp) || Number(entry?.time) || null,
        eventType,
        isEcho
      }));
    }
  }

  return events;
}

function defaultEventSink(event) {
  console.log('[META_WEBHOOK_RECEIVE_ONLY]', {
    source: event.source,
    channel: event.channel,
    object: event.object,
    accountId: event.accountId || null,
    senderId: event.senderId || null,
    recipientId: event.recipientId || null,
    messageId: event.messageId || null,
    eventType: event.eventType,
    isEcho: event.isEcho === true,
    text: event.text || null,
    timestamp: event.timestamp || null,
    action: 'RECEIVE_ONLY_NO_REPLY_NO_CRM'
  });
}

function createMetaWebhookApi({
  env = process.env,
  eventSink = defaultEventSink
} = {}) {
  return async function handleMetaWebhookApi({ req, res, sendJson }) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/webhooks/meta') return false;

    if (req.method === 'GET') {
      const mode = clean(url.searchParams.get('hub.mode'));
      const challenge = clean(url.searchParams.get('hub.challenge'));
      const verifyToken = clean(url.searchParams.get('hub.verify_token'));
      const expectedToken = clean(env.META_WEBHOOK_VERIFY_TOKEN);

      if (
        mode === 'subscribe' &&
        challenge &&
        expectedToken &&
        safeEqual(verifyToken, expectedToken)
      ) {
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(challenge);
        return true;
      }

      sendJson(res, 403, {
        ok: false,
        error: {
          code: 'META_WEBHOOK_VERIFICATION_FAILED'
        }
      });
      return true;
    }

    if (req.method === 'POST') {
      const appSecret = clean(env.META_APP_SECRET);
      if (!appSecret) {
        sendJson(res, 503, {
          ok: false,
          error: {
            code: 'META_APP_SECRET_REQUIRED'
          }
        });
        return true;
      }

      let rawBody;
      try {
        rawBody = await readRawBody(req);
      } catch (error) {
        sendJson(res, 413, {
          ok: false,
          error: {
            code: error?.code || 'META_WEBHOOK_BODY_FAILED'
          }
        });
        return true;
      }

      const signature = req.headers['x-hub-signature-256'];
      if (!verifySignature({ rawBody, signature, appSecret })) {
        sendJson(res, 401, {
          ok: false,
          error: {
            code: 'META_WEBHOOK_SIGNATURE_INVALID'
          }
        });
        return true;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: {
            code: 'META_WEBHOOK_JSON_INVALID'
          }
        });
        return true;
      }

      const events = normalizeMetaMessagingEvents(payload);
      for (const event of events) {
        try {
          await eventSink(event);
        } catch (error) {
          console.error('[META_WEBHOOK_EVENT_SINK_FAILED]', {
            code: error?.code || null,
            message: error?.message || String(error)
          });
        }
      }

      sendJson(res, 200, {
        ok: true,
        status: 'EVENT_RECEIVED',
        mode: 'RECEIVE_ONLY',
        events: events.length,
        messagesSent: 0,
        crmWrites: 0
      });
      return true;
    }

    res.writeHead(405, { Allow: 'GET, POST' });
    res.end();
    return true;
  };
}

module.exports = {
  createMetaWebhookApi,
  defaultEventSink,
  normalizeMetaMessagingEvents,
  readRawBody,
  verifySignature
};
