'use strict';

const {
  extractIncoming,
  isLiveModeRequest,
  resolveOwnerIdentityFromIncoming,
  sendWahaText
} = require('./wahaWebhookApi');
const { normalizeWahaVoiceEvent } = require('../modules/voicePipelineV2/wahaVoiceEvent');
const { createConnectLiveSession } = require('../services/connectLiveAccessService');
const {
  downloadWahaMedia,
  resolveAudioMimeType,
  transcribeAudio
} = require('../services/connectVoiceService');

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

function mergeVoiceIncoming(legacyIncoming, voiceEvent) {
  if (!voiceEvent) return legacyIncoming;
  return {
    ...legacyIncoming,
    ...voiceEvent,
    messageType: 'audio',
    media: {
      ...(legacyIncoming?.media || {}),
      ...(voiceEvent.media || {})
    },
    identityCandidates: legacyIncoming?.identityCandidates || []
  };
}

async function resolveOwnerLiveMessage(incoming, dependencies = {}) {
  if (incoming.messageType !== 'audio') return String(incoming.text || '').trim();

  if (!incoming.media?.url) {
    const error = new Error('WAHA_AUDIO_MEDIA_URL_MISSING');
    error.code = 'WAHA_AUDIO_MEDIA_URL_MISSING';
    throw error;
  }

  const downloadMediaImpl = dependencies.downloadWahaMedia || downloadWahaMedia;
  const transcribeImpl = dependencies.transcribeAudio || transcribeAudio;

  const media = await downloadMediaImpl({ url: incoming.media.url });
  const mimeType = resolveAudioMimeType({
    downloadedMimeType: media.mimeType,
    webhookMimeType: incoming.media.mimeType
  });

  return String(await transcribeImpl({
    audio: media.buffer,
    mimeType,
    filename: incoming.media.filename
  }) || '').trim();
}

async function handleOwnerCopilotActivation({ incoming, dependencies = {} }) {
  const ownerIdentity = resolveOwnerIdentityFromIncoming(incoming);
  if (!ownerIdentity?.isOwner) return { handled: false };

  if (!['text', 'audio'].includes(incoming.messageType)) return { handled: false };

  const message = await resolveOwnerLiveMessage(incoming, dependencies);
  if (!message || !isLiveModeRequest(message)) return { handled: false };

  const createLiveImpl = dependencies.createConnectLiveSession || createConnectLiveSession;
  const sendTextImpl = dependencies.sendWahaText || sendWahaText;

  try {
    const live = await createLiveImpl({
      phone: ownerIdentity.phone || incoming.phone,
      identity: ownerIdentity.canonicalId || incoming.senderRaw,
      platform: process.env.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL'
    });

    await sendTextImpl({
      session: incoming.session,
      chatId: incoming.chatId,
      text: `ELAN Copiloto listo. Abrí tu sesión segura:\n${live.url}\n\nLa sesión vence en 15 minutos.`
    });

    return {
      handled: true,
      payload: {
        ok: true,
        processed: true,
        replySent: true,
        replyType: 'text',
        ownerMode: true,
        elanLive: true,
        pipeline: 'owner-copilot-live'
      }
    };
  } catch (error) {
    const denied = error?.status === 403;

    await sendTextImpl({
      session: incoming.session,
      chatId: incoming.chatId,
      text: denied
        ? 'Este número no tiene acceso autorizado a ELAN Copiloto.'
        : 'No pude crear la sesión de ELAN Copiloto en este momento.'
    });

    return {
      handled: true,
      payload: {
        ok: false,
        processed: true,
        replySent: true,
        ownerMode: true,
        elanLive: true,
        code: error?.code || null,
        pipeline: 'owner-copilot-live'
      }
    };
  }
}

async function handleWahaWebhookApiV2({ req, res, sendJson, dependencies = {} }) {
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
    const legacyIncoming = extractIncoming(body);
    const voiceEvent = normalizeWahaVoiceEvent(body);
    const incoming = mergeVoiceIncoming(legacyIncoming, voiceEvent);
    const reason = ignoredReason(incoming);

    if (reason) {
      sendJson(res, 200, { ok: true, ignored: true, reason });
      return true;
    }

    const copilot = await handleOwnerCopilotActivation({ incoming, dependencies });
    if (copilot.handled) {
      sendJson(res, 200, copilot.payload);
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
  handleOwnerCopilotActivation,
  handleWahaWebhookApi: handleWahaWebhookApiV2,
  handleWahaWebhookApiV2,
  mergeVoiceIncoming,
  readJsonBody,
  resolveOwnerLiveMessage
};
