'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

function getConnectConfig() {
  return {
    baseUrl: normalizeBaseUrl(process.env.ELANKAV_CONNECT_URL, DEFAULT_CONNECT_URL),
    token: String(process.env.CONNECT_VOICE_TOKEN || '').trim()
  };
}

function getWahaConfig() {
  return {
    baseUrl: normalizeBaseUrl(process.env.WAHA_BASE_URL, DEFAULT_WAHA_BASE_URL),
    apiKey: String(process.env.WAHA_API_KEY || process.env.WAHA_API_TOKEN || '').trim()
  };
}

function createHttpError(code, status, message) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function resolveMediaUrl(mediaUrl) {
  const { baseUrl } = getWahaConfig();
  const source = new URL(String(mediaUrl || ''));
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(source.hostname)) {
    const target = new URL(baseUrl);
    source.protocol = target.protocol;
    source.host = target.host;
  }
  return source.toString();
}

async function downloadWahaMedia({ url, fetchImpl = fetch }) {
  if (!url) throw createHttpError('WAHA_MEDIA_URL_REQUIRED', 400);
  const { apiKey } = getWahaConfig();
  const headers = {};
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const response = await fetchImpl(resolveMediaUrl(url), {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw createHttpError('WAHA_MEDIA_DOWNLOAD_FAILED', response.status, `WAHA media HTTP ${response.status}`);
  }

  const announcedSize = Number(response.headers.get('content-length') || 0);
  if (announcedSize > MAX_AUDIO_BYTES) {
    throw createHttpError('WAHA_MEDIA_TOO_LARGE', 413);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw createHttpError('WAHA_MEDIA_EMPTY', 422);
  if (buffer.length > MAX_AUDIO_BYTES) throw createHttpError('WAHA_MEDIA_TOO_LARGE', 413);

  return {
    buffer,
    mimeType: response.headers.get('content-type') || 'audio/ogg'
  };
}

async function connectRequest(path, options = {}, fetchImpl = fetch) {
  const { baseUrl, token } = getConnectConfig();
  if (!token) throw createHttpError('CONNECT_VOICE_TOKEN_REQUIRED', 503);

  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'X-Elankav-Voice-Token': token,
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(60_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createHttpError(
      payload?.error?.code || 'CONNECT_VOICE_REQUEST_FAILED',
      response.status,
      payload?.error?.message || `CONNECT voice HTTP ${response.status}`
    );
  }
  return payload;
}

async function transcribeAudio({ audio, mimeType, filename, fetchImpl = fetch }) {
  const payload = await connectRequest('/api/v1/voice/transcriptions', {
    method: 'POST',
    headers: {
      'Content-Type': mimeType || 'audio/ogg',
      'X-File-Name': filename || 'voice.ogg',
      'X-Audio-Language': 'es'
    },
    body: audio
  }, fetchImpl);
  const text = String(payload?.text || '').trim();
  if (!text) throw createHttpError('CONNECT_TRANSCRIPTION_EMPTY', 502);
  return text;
}

async function synthesizeSpeech({ text, fetchImpl = fetch }) {
  const payload = await connectRequest('/api/v1/voice/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }, fetchImpl);
  const data = String(payload?.data || '').trim();
  if (!data) throw createHttpError('CONNECT_SPEECH_EMPTY', 502);
  return {
    data,
    mimeType: String(payload?.mimeType || 'audio/ogg; codecs=opus')
  };
}

module.exports = {
  MAX_AUDIO_BYTES,
  downloadWahaMedia,
  getConnectConfig,
  resolveMediaUrl,
  synthesizeSpeech,
  transcribeAudio
};
