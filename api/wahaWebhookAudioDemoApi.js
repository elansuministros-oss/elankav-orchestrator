'use strict';

const { EventEmitter } = require('node:events');
const {
  extractIncoming,
  handleWahaWebhookApi: handleBaseWahaWebhookApi
} = require('./wahaWebhookApi');
const {
  generateOwnerPresentationAudio,
  isOwnerPhone,
  isOwnerPresentationDemoRequest
} = require('../services/ownerPresentationAudioService');

const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const MAX_BODY_BYTES = 1024 * 1024;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = Buffer.alloc(0);
    let settled = false;

    req.on('data', chunk => {
      if (settled) return;
      body = Buffer.concat([body, Buffer.from(chunk)]);
      if (body.length > MAX_BODY_BYTES) {
        settled = true;
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy?.();
      }
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(body);
    });

    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function parseJsonBody(rawBody) {
  const text = Buffer.from(rawBody || '').toString('utf8').trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('INVALID_JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function createReplayRequest(req, rawBody) {
  const replay = new EventEmitter();
  replay.method = req.method;
  replay.url = req.url;
  replay.headers = { ...(req.headers || {}) };
  replay.destroy = () => {};

  process.nextTick(() => {
    if (rawBody?.length) replay.emit('data', rawBody);
    replay.emit('end');
  });

  return replay;
}

async function sendWahaVoice({ session, chatId, audio, fetchImpl = fetch }) {
  const baseUrl = String(process.env.WAHA_BASE_URL || DEFAULT_WAHA_BASE_URL)
    .replace(/\/+$/, '');
  const apiKey = process.env.WAHA_API_KEY || process.env.WAHA_API_TOKEN || '';
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };

  if (apiKey) headers['X-Api-Key'] = apiKey;

  const response = await fetchImpl(`${baseUrl}/api/sendVoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session,
      chatId,
      file: {
        mimetype: audio.mimetype,
        filename: audio.filename,
        data: audio.data
      },
      convert: false
    })
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

function shouldHandleOwnerAudioDemo(incoming) {
  return Boolean(
    incoming &&
    !incoming.fromMe &&
    !incoming.isGroup &&
    !incoming.isBroadcast &&
    incoming.chatId &&
    isOwnerPhone(incoming.phone) &&
    isOwnerPresentationDemoRequest(incoming.text)
  );
}

async function handleWahaWebhookAudioDemoApi({ req, res, sendJson, dependencies = {} }) {
  const requestUrl = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
  if (requestUrl.pathname !== '/webhook/inbound') return false;

  if (req.method !== 'POST') {
    return handleBaseWahaWebhookApi({ req, res, sendJson, dependencies });
  }

  try {
    const rawBody = await readRawBody(req);
    const body = parseJsonBody(rawBody);
    const incoming = extractIncoming(body);

    if (!shouldHandleOwnerAudioDemo(incoming)) {
      return handleBaseWahaWebhookApi({
        req: createReplayRequest(req, rawBody),
        res,
        sendJson,
        dependencies
      });
    }

    const generateAudioImpl =
      dependencies.generateOwnerPresentationAudio || generateOwnerPresentationAudio;
    const sendVoiceImpl = dependencies.sendWahaVoice || sendWahaVoice;
    const audio = await generateAudioImpl();

    await sendVoiceImpl({
      session: incoming.session,
      chatId: incoming.chatId,
      audio
    });

    console.log('[OWNER_PRESENTATION_AUDIO_SENT]', {
      session: incoming.session,
      chatId: incoming.chatId,
      phone: incoming.phone
    });

    sendJson(res, 200, {
      ok: true,
      processed: true,
      replySent: true,
      replyType: 'voice',
      ownerMode: true,
      action: 'OWNER_PRESENTATION_AUDIO_DEMO'
    });
  } catch (error) {
    console.error('[OWNER_PRESENTATION_AUDIO_ERROR]', {
      message: error.message,
      code: error.code || null,
      status: error.status || null
    });

    sendJson(res, 200, {
      ok: false,
      processed: false,
      replySent: false,
      ownerMode: true,
      action: 'OWNER_PRESENTATION_AUDIO_DEMO',
      error: error.message,
      code: error.code || null
    });
  }

  return true;
}

module.exports = {
  createReplayRequest,
  handleWahaWebhookAudioDemoApi,
  parseJsonBody,
  readRawBody,
  sendWahaVoice,
  shouldHandleOwnerAudioDemo
};
