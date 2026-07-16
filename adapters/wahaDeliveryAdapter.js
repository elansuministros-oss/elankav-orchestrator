'use strict';

const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const DEFAULT_WAHA_SESSION = 'ELANKAV';
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp'
]);

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 8 ? `505${digits}` : digits;
}

function buildChatId(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? `${normalized}@c.us` : '';
}

function buildDesignReadyMessage(row = {}) {
  const name = String(row.customer_name || '').trim();
  const requestCode = String(row.request_code || '').trim().toUpperCase();
  const greeting = name ? `Hola, ${name}.` : 'Hola.';

  return [
    greeting,
    'Tu propuesta de diseño está lista.',
    '',
    'Código de seguimiento:',
    requestCode,
    '',
    'Para solicitar cambios respondé:',
    `CAMBIOS ${requestCode}: detalle del cambio`,
    '',
    'Para consultar el estado enviá únicamente:',
    requestCode
  ].join('\n');
}

function buildDesignReadyCaption(row = {}) {
  const requestCode = String(row.request_code || '').trim().toUpperCase();
  return [
    'Tu propuesta de diseño está lista.',
    `Código de seguimiento: ${requestCode}`
  ].join('\n');
}

function buildDesignFollowupInstructions(row = {}) {
  const requestCode = String(row.request_code || '').trim().toUpperCase();
  return [
    'Para solicitar cambios respondé:',
    `CAMBIOS ${requestCode}: detalle del cambio`,
    '',
    'Para consultar el estado enviá únicamente:',
    requestCode
  ].join('\n');
}

function assertImageDeliveryInput({ imageUrl, mimeType }) {
  const value = String(imageUrl || '').trim();
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid');
  } catch {
    const error = new Error('WAHA_IMAGE_URL_REQUIRED');
    error.code = 'WAHA_IMAGE_URL_REQUIRED';
    throw error;
  }

  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    const error = new Error('WAHA_IMAGE_MIME_UNSUPPORTED');
    error.code = 'WAHA_IMAGE_MIME_UNSUPPORTED';
    throw error;
  }
}

function extractMessageId(data) {
  return data?.id?.id || data?._data?.id?.id || data?.messageId || data?.id || null;
}

function createWahaDeliveryAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = String(env.WAHA_BASE_URL || DEFAULT_WAHA_BASE_URL).replace(/\/+$/, '');
  const apiKey = String(env.WAHA_API_KEY || env.WAHA_API_TOKEN || '').trim();
  const session = String(env.WAHA_SESSION || DEFAULT_WAHA_SESSION).trim();

  function createHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-Api-Key'] = apiKey;
    return headers;
  }

  function resolveChatId({ phone, chatId }) {
    const resolvedChatId = String(chatId || buildChatId(phone)).trim();
    if (!resolvedChatId) {
      const error = new Error('WAHA_CHAT_ID_REQUIRED');
      error.code = 'WAHA_CHAT_ID_REQUIRED';
      throw error;
    }
    return resolvedChatId;
  }

  async function sendText({ phone, chatId, text }) {
    const resolvedChatId = resolveChatId({ phone, chatId });
    if (!String(text || '').trim()) {
      const error = new Error('WAHA_TEXT_REQUIRED');
      error.code = 'WAHA_TEXT_REQUIRED';
      throw error;
    }

    const response = await fetchImpl(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers: createHeaders(),
      body: JSON.stringify({ session, chatId: resolvedChatId, text })
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(data?.message || data?.error || `WAHA HTTP ${response.status}`);
      error.code = `WAHA_HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }

    return Object.freeze({
      chatId: resolvedChatId,
      messageId: extractMessageId(data),
      response: data
    });
  }

  async function sendImage({ phone, chatId, imageUrl, caption, fileName, mimeType }) {
    const resolvedChatId = resolveChatId({ phone, chatId });
    assertImageDeliveryInput({ imageUrl, mimeType });

    const response = await fetchImpl(`${baseUrl}/api/sendImage`, {
      method: 'POST',
      headers: createHeaders(),
      body: JSON.stringify({
        session,
        chatId: resolvedChatId,
        caption: String(caption || ''),
        file: {
          url: String(imageUrl).trim(),
          filename: String(fileName || 'design-render.png'),
          mimetype: String(mimeType || '').split(';')[0].trim().toLowerCase()
        }
      })
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(data?.message || data?.error || `WAHA HTTP ${response.status}`);
      error.code = `WAHA_HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }

    return Object.freeze({
      chatId: resolvedChatId,
      messageId: extractMessageId(data),
      response: data
    });
  }

  return Object.freeze({ sendImage, sendText });
}

module.exports = {
  DEFAULT_WAHA_BASE_URL,
  DEFAULT_WAHA_SESSION,
  buildChatId,
  buildDesignFollowupInstructions,
  buildDesignReadyCaption,
  buildDesignReadyMessage,
  createWahaDeliveryAdapter,
  assertImageDeliveryInput,
  normalizePhone
};
