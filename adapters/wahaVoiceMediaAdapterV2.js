'use strict';

function normalizeBaseUrl(value) {
  return String(value || 'https://waha.elankav.com').replace(/\/+$/, '');
}

function queryableMessageId(messageId) {
  const value = String(messageId || '').trim();
  if (!value) return '';
  const parts = value.split('_').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : value;
}

function extractRecoveredMedia(payload = {}) {
  const message = payload.payload || payload.message || payload;
  const media = message.media || message._data?.media || null;
  return {
    url: String(message.mediaUrl || message.downloadUrl || message.url || message._data?.mediaUrl || media?.url || '').trim(),
    mimeType: String(message.mimetype || message.mimeType || message._data?.mimetype || media?.mimetype || media?.mimeType || 'audio/ogg'),
    filename: String(message.filename || media?.filename || 'voice.ogg')
  };
}

function createWahaVoiceMediaAdapterV2({ env = process.env, fetchImpl = fetch } = {}) {
  const baseUrl = normalizeBaseUrl(env.WAHA_INTERNAL_BASE_URL || env.WAHA_BASE_URL);
  const apiKey = String(env.WAHA_API_KEY || env.WAHA_API_TOKEN || '').trim();

  return {
    async recoverMessage({ session, messageId }) {
      const id = queryableMessageId(messageId);
      if (!id) {
        const error = new Error('WAHA_MESSAGE_ID_REQUIRED');
        error.code = 'WAHA_MESSAGE_ID_REQUIRED';
        throw error;
      }
      const path = `/api/${encodeURIComponent(session || env.WAHA_SESSION || 'default')}/chats/all/messages/${encodeURIComponent(id)}?downloadMedia=true`;
      const headers = { Accept: 'application/json' };
      if (apiKey) headers['X-Api-Key'] = apiKey;
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(Number(env.WAHA_MEDIA_TIMEOUT_MS || 30000))
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.message || `WAHA_MESSAGE_RECOVERY_HTTP_${response.status}`);
        error.code = 'WAHA_MESSAGE_RECOVERY_FAILED';
        error.status = response.status;
        throw error;
      }
      const media = extractRecoveredMedia(payload);
      if (!media.url) {
        const error = new Error('WAHA_AUDIO_MEDIA_URL_MISSING');
        error.code = 'WAHA_AUDIO_MEDIA_URL_MISSING';
        throw error;
      }
      return media;
    }
  };
}

module.exports = { createWahaVoiceMediaAdapterV2, extractRecoveredMedia, queryableMessageId };
