'use strict';

const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const DEFAULT_WAHA_SESSION = 'ELANKAV';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp'
]);
const SUPPORTED_FILE_MIME_TYPES = new Set([
  'application/pdf'
]);
const SUPPORTED_VOICE_MIME_TYPES = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a'
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

function normalizedMime(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function assertImageDeliveryInput({ imageUrl, mimeType }) {
  assertPublicUrl(imageUrl, 'WAHA_IMAGE_URL_REQUIRED');

  const normalizedMimeType = normalizedMime(mimeType);
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    const error = new Error('WAHA_IMAGE_MIME_UNSUPPORTED');
    error.code = 'WAHA_IMAGE_MIME_UNSUPPORTED';
    throw error;
  }
}

function assertImageBytes(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    const error = new Error('WAHA_IMAGE_BYTES_INVALID');
    error.code = 'WAHA_IMAGE_BYTES_INVALID';
    throw error;
  }

  const mime = normalizedMime(mimeType);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  const valid = mime === 'image/jpeg' ? jpeg : mime === 'image/png' ? png : mime === 'image/webp' ? webp : false;

  if (!valid) {
    const error = new Error('WAHA_IMAGE_CONTENT_INVALID');
    error.code = 'WAHA_IMAGE_CONTENT_INVALID';
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

  const normalizedMimeType = normalizedMime(mimeType);
  if (!SUPPORTED_FILE_MIME_TYPES.has(normalizedMimeType)) {
    const error = new Error('WAHA_FILE_MIME_UNSUPPORTED');
    error.code = 'WAHA_FILE_MIME_UNSUPPORTED';
    throw error;
  }
}

function assertVoiceDeliveryInput({ data, mimeType }) {
  if (!String(data || '').trim()) {
    const error = new Error('WAHA_VOICE_DATA_REQUIRED');
    error.code = 'WAHA_VOICE_DATA_REQUIRED';
    throw error;
  }

  const normalizedMimeType = normalizedMime(mimeType);
  if (!SUPPORTED_VOICE_MIME_TYPES.has(normalizedMimeType)) {
    const error = new Error('WAHA_VOICE_MIME_UNSUPPORTED');
    error.code = 'WAHA_VOICE_MIME_UNSUPPORTED';
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

  async function fetchImageBytes(imageUrl, mimeType) {
    const response = await fetchImpl(assertPublicUrl(imageUrl, 'WAHA_IMAGE_URL_REQUIRED'), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      const error = new Error(`WAHA_IMAGE_FETCH_FAILED:${response.status}`);
      error.code = 'WAHA_IMAGE_FETCH_FAILED';
      error.status = response.status;
      throw error;
    }

    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > MAX_IMAGE_BYTES) {
      const error = new Error('WAHA_IMAGE_BYTES_INVALID');
      error.code = 'WAHA_IMAGE_BYTES_INVALID';
      throw error;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    assertImageBytes(bytes, mimeType);
    return bytes;
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

  async function sendImageData({ phone, chatId, data, caption, fileName, mimeType }) {
    const resolvedChatId = resolveChatId({ phone, chatId });
    const normalizedMimeType = normalizedMime(mimeType);
    const raw = String(data || '').trim();
    const base64 = raw.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
    let bytes;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch {
      const error = new Error('WAHA_IMAGE_DATA_INVALID');
      error.code = 'WAHA_IMAGE_DATA_INVALID';
      throw error;
    }
    assertImageBytes(bytes, normalizedMimeType);

    const response = await requestWaha('/api/sendImage', {
      session,
      chatId: resolvedChatId,
      caption: String(caption || ''),
      file: {
        data: bytes.toString('base64'),
        filename: String(fileName || 'captura-campo.jpg'),
        mimetype: normalizedMimeType
      }
    });

    return Object.freeze({
      chatId: resolvedChatId,
      messageId: extractMessageId(response),
      response
    });
  }

  async function sendImage({ phone, chatId, imageUrl, caption, fileName, mimeType }) {
    const resolvedChatId = resolveChatId({ phone, chatId });
    assertImageDeliveryInput({ imageUrl, mimeType });
    const normalizedMimeType = normalizedMime(mimeType);
    const bytes = await fetchImageBytes(imageUrl, normalizedMimeType);

    const data = await requestWaha('/api/sendImage', {
      session,
      chatId: resolvedChatId,
      caption: String(caption || ''),
      file: {
        data: bytes.toString('base64'),
        filename: String(fileName || 'design-render.png'),
        mimetype: normalizedMimeType
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
        mimetype: normalizedMime(mimeType)
      }
    });

    return Object.freeze({
      chatId: resolvedChatId,
      messageId: extractMessageId(data),
      response: data
    });
  }

  async function sendVoice({ phone, chatId, data, mimeType }) {
    const resolvedChatId = resolveChatId({ phone, chatId });
    assertVoiceDeliveryInput({ data, mimeType });
    const normalizedMimeType = normalizedMime(mimeType);

    const response = await requestWaha('/api/sendVoice', {
      session,
      chatId: resolvedChatId,
      file: {
        mimetype: normalizedMimeType,
        data: String(data).trim()
      },
      convert: true
    });

    return Object.freeze({
      chatId: resolvedChatId,
      messageId: extractMessageId(response),
      response
    });
  }

  return Object.freeze({ sendFile, sendImage, sendImageData, sendText, sendVoice });
}

module.exports = {
  DEFAULT_WAHA_BASE_URL,
  DEFAULT_WAHA_SESSION,
  MAX_IMAGE_BYTES,
  assertFileDeliveryInput,
  assertImageBytes,
  assertImageDeliveryInput,
  assertVoiceDeliveryInput,
  buildChatId,
  buildDesignFollowupInstructions,
  buildDesignReadyCaption,
  buildDesignReadyMessage,
  createWahaDeliveryAdapter,
  normalizePhone
};
