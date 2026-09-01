'use strict';

const { extractIncoming } = require('./wahaWebhookApi');
const { normalizeWahaVoiceEvent } = require('../modules/voicePipelineV2/wahaVoiceEvent');

const MAX_BODY_BYTES = 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let receivedBytes = 0;

    req.on('data', chunk => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        const error = new Error('PAYLOAD_TOO_LARGE');
        error.code = 'PAYLOAD_TOO_LARGE';
        reject(error);
        req.destroy?.();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('INVALID_JSON');
        error.code = 'INVALID_JSON';
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function ignoredReason(incoming) {
  if (incoming.event && !['message', 'message.any'].includes(incoming.event)) return 'EVENT_NOT_MESSAGE';
  if (incoming.fromMe) return 'FROM_ME';
  if (incoming.isGroup) return 'GROUP_MESSAGE';
  if (incoming.isBroadcast) return 'BROADCAST_MESSAGE';
  if (!incoming.chatId || !incoming.senderRaw) return 'MESSAGE_INCOMPLETE';
  return '';
}

async function handleWahaWebhookApiV2({ req, res, sendJson }) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname !== '/webhook/inbound') return false;

  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'ELANKAV WAHA Inbound Bridge',
      status: 'READY',
      version: 'CUSTOMER-AUTO-REPLY-DISABLED'
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
    const incoming = voiceEvent || extractIncoming(body);
    const reason = ignoredReason(incoming);

    if (reason) {
      sendJson(res, 200, { ok: true, ignored: true, reason });
      return true;
    }

    sendJson(res, 200, {
      ok: true,
      processed: true,
      replySent: false,
      automationDisabled: true,
      messageType: voiceEvent ? 'voice' : incoming.messageType || 'unknown',
      pipeline: 'customer-auto-reply-disabled'
    });
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      processed: false,
      replySent: false,
      code: error.code || 'WAHA_WEBHOOK_INVALID_REQUEST',
      pipeline: 'customer-auto-reply-disabled'
    });
  }

  return true;
}

module.exports = {
  handleWahaWebhookApi: handleWahaWebhookApiV2,
  handleWahaWebhookApiV2,
  readJsonBody
};
