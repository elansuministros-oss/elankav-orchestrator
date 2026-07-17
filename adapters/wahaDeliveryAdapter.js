'use strict';

const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const DEFAULT_WAHA_SESSION = 'ELANKAV';
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp'
]);
const SUPPORTED_FILE_MIME_TYPES = new Set([
  'application/pdf'
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

function assertPublicUrl(value, errorCode) {
  const normalized = String(value || '').trim();
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid');
    return normalized;
  } catch {
    const error = new Error(errorCode);
    error.code = errorCode;
    throw error;
  }
}

function assertImageDeliveryInput({ imageUrl, mimeType }) {
  assertPublicUrl(imageUrl, 'WAHA_IMAGE_URL_REQUIRED');

  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    const error = new Error('WAHA_IMAGE_MIME_UNSUPPORTED');
    error.code = 'WAHA_IMAGE_MIME_UNSUPPORTED';
    throw error;
  }
}

function assertFileDeliveryInput({ fileUrl, fileName, mimeType }) {
  assertPublicUrl(fileUrl, 'WAHA_FILE_URL_REQUIRED');

  if (!String(fileName || '').trim()) {
    const error = new Error('WAHA_FILE_NAME_REQUIRED');
    error.code = 'WAHA_FILE_NAME_REQUIRED';
    throw error;
  }

  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!SUPPORTED_FILE_MIME_TYPES.has(normalizedMimeType)) {
    const error = new Error('WAHA_FILE_MIME_UNSUPPORTED');
    error.code = 'WAHA_FILE_MIME_UNSUPPORTED';
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

  async function requestWaha(path, body) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: createHeaders(),
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(data?.message || data?.error || `WAHA HTTP ${response.status}`);
      error.code = `WAHA_HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }

    return data;
  }

  async function sendText({ phone, chatId, text }) {
    const resolvedChatId = resolveChatId({ phone, chatId });
    if (!String(text || '').trim()) {
      const error = new Error('WAHA_TEXT_REQUIRED');
      error.code = 'WAHA_TEXT_REQUIRED';
      throw error;
    }

    const data = await requestWaha('/api/sendText', {
      session,
      chatId: resolvedChatId,
      text
    });

    return Object.freeze({
      chatId: resolvedChatId,
      messageId: extractMessageId(data),
      response: data
    });
  }

  async function sendImage({ phone, chatId, imageUrl, caption, fileName, mimeType }) {
    const resolvedChatId = resolveChatId({ phone, chatId });
    assertImageDeliveryInput({ imageUrl, mimeType });

    const data = await requestWaha('/api/sendImage', {
      session,
      chatId: resolvedChatId,
      caption: String(caption || ''),
      file: {
        url: String(imageUrl).trim(),
        filename: String(fileName || 'design-render.png'),
        mimetype: String(mimeType || '').split(';')[0].trim().toLowerCase()
      }
    });

    return Object.freeze({
      chatId: resolvedChatId,
      messageId: extractMessageId(data),
      response: data
    });
  }

  async function sendFile({ phone, chatId, fileUrl, caption, fileName, mimeType }) {
    const resolvedChatId = resolveChatId({ phone, chatId });
    assertFileDeliveryInput({ fileUrl, fileName, mimeType });

    const data = await requestWaha('/api/sendFile', {
      session,
      chatId: resolvedChatId,
      caption: String(caption || ''),
      file: {
        url: String(fileUrl).trim(),
        filename: String(fileName).trim(),
        mimetype: String(mimeType).split(';')[0].trim().toLowerCase()
      }
    });

    return Object.freeze({
      chatId: resolvedChatId,
      messageId: extractMessageId(data),
      response: data
    });
  }

  return Object.freeze({ sendFile, sendImage, sendText });
}

module.exports = {
  DEFAULT_WAHA_BASE_URL,
  DEFAULT_WAHA_SESSION,
  assertFileDeliveryInput,
  assertImageDeliveryInput,
  buildChatId,
  buildDesignFollowupInstructions,
  buildDesignReadyCaption,
  buildDesignReadyMessage,
  createWahaDeliveryAdapter,
  normalizePhone
};