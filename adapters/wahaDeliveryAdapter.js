'use strict';

const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const DEFAULT_WAHA_SESSION = 'ELANKAV';

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

function createWahaDeliveryAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = String(env.WAHA_BASE_URL || DEFAULT_WAHA_BASE_URL).replace(/\/+$/, '');
  const apiKey = String(env.WAHA_API_KEY || env.WAHA_API_TOKEN || '').trim();
  const session = String(env.WAHA_SESSION || DEFAULT_WAHA_SESSION).trim();

  async function sendText({ phone, chatId, text }) {
    const resolvedChatId = String(chatId || buildChatId(phone)).trim();
    if (!resolvedChatId) {
      const error = new Error('WAHA_CHAT_ID_REQUIRED');
      error.code = 'WAHA_CHAT_ID_REQUIRED';
      throw error;
    }
    if (!String(text || '').trim()) {
      const error = new Error('WAHA_TEXT_REQUIRED');
      error.code = 'WAHA_TEXT_REQUIRED';
      throw error;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-Api-Key'] = apiKey;

    const response = await fetchImpl(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers,
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
      messageId: data?.id?.id || data?._data?.id?.id || null,
      response: data
    });
  }

  return Object.freeze({ sendText });
}

module.exports = {
  DEFAULT_WAHA_BASE_URL,
  DEFAULT_WAHA_SESSION,
  buildChatId,
  buildDesignReadyMessage,
  createWahaDeliveryAdapter,
  normalizePhone
};
