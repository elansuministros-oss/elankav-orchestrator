'use strict';

const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');

const MAX_BODY_BYTES = 256 * 1024;

function clean(value) {
  return String(value || '').trim();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let receivedBytes = 0;
    req.on('data', chunk => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(Object.assign(new Error('INVALID_JSON'), { code: 'INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

function tokenFrom(req) {
  const auth = clean(req.headers.authorization);
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return clean(req.headers['x-elankav-connect-token']);
}

function assertInternalRequest(req) {
  const expected = clean(process.env.ORCHESTRATOR_INTERNAL_TOKEN || process.env.CONNECT_INTERNAL_TOKEN);
  if (!expected) {
    const error = new Error('ORCHESTRATOR_INTERNAL_TOKEN_REQUIRED');
    error.code = 'ORCHESTRATOR_INTERNAL_TOKEN_REQUIRED';
    error.status = 503;
    throw error;
  }
  if (tokenFrom(req) !== expected) {
    const error = new Error('UNAUTHORIZED');
    error.code = 'UNAUTHORIZED';
    error.status = 401;
    throw error;
  }
}

async function handleConnectConversationApi({ req, res, sendJson, dependencies = {} }) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname !== '/api/waha/send-text') return false;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Metodo no permitido' } });
    return true;
  }

  try {
    assertInternalRequest(req);
    const body = await readJsonBody(req);
    const text = clean(body.text);
    const chatId = clean(body.chatId);
    const phone = clean(body.phone);
    if (!text) throw Object.assign(new Error('WAHA_TEXT_REQUIRED'), { code: 'WAHA_TEXT_REQUIRED', status: 400 });
    if (!chatId && !phone) throw Object.assign(new Error('WAHA_DESTINATION_REQUIRED'), { code: 'WAHA_DESTINATION_REQUIRED', status: 400 });

    const delivery = dependencies.delivery || createWahaDeliveryAdapter();
    const sent = await delivery.sendText({ chatId, phone, text });
    sendJson(res, 200, {
      ok: true,
      chatId: sent.chatId,
      messageId: sent.messageId || null,
      sent
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: {
        code: error.code || 'WAHA_SEND_FAILED',
        message: error.message || 'WAHA_SEND_FAILED'
      }
    });
  }

  return true;
}

module.exports = { handleConnectConversationApi, readJsonBody };

