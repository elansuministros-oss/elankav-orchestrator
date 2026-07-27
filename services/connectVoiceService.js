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

function buildConnectHeaders(extraHeaders = {}) {
  const { token } = getConnectConfig();
  if (!token) throw createHttpError('CONNECT_VOICE_TOKEN_REQUIRED', 503);
  return {
    'X-Connect-Voice-Token': token,
    ...extraHeaders
  };
}

async function readConnectError(response) {
  const payload = await response.json().catch(() => ({}));
  return createHttpError(
    payload?.error?.code || 'CONNECT_VOICE_REQUEST_FAILED',
    response.status,
    payload?.error?.message || `CONNECT voice HTTP ${response.status}`
  );
}

async function transcribeAudio({ audio, mimeType, filename, fetchImpl = fetch }) {
  if (!audio?.length) throw createHttpError('CONNECT_AUDIO_REQUIRED', 400);

  const { baseUrl } = getConnectConfig();
  const form = new FormData();
  const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
  form.append('file', new Blob([bytes], { type: mimeType || 'audio/ogg' }), filename || 'voice.ogg');
  form.append('language', 'es');

  const response = await fetchImpl(`${baseUrl}/api/v1/voice/transcriptions`, {
    method: 'POST',
    headers: buildConnectHeaders({ Accept: 'application/json' }),
    body: form,
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) throw await readConnectError(response);

  const payload = await response.json().catch(() => ({}));
  const text = String(payload?.text || '').trim();
  if (!text) throw createHttpError('CONNECT_TRANSCRIPTION_EMPTY', 502);
  return text;
}

async function synthesizeSpeech({ text, fetchImpl = fetch }) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) throw createHttpError('CONNECT_SPEECH_TEXT_REQUIRED', 400);

  const { baseUrl } = getConnectConfig();
  const response = await fetchImpl(`${baseUrl}/api/v1/voice/speech`, {
    method: 'POST',
    headers: buildConnectHeaders({
      Accept: 'audio/opus, audio/mpeg, audio/wav',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ text: normalizedText, format: 'opus' }),
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) throw await readConnectError(response);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw createHttpError('CONNECT_SPEECH_EMPTY', 502);

  return {
    data: buffer.toString('base64'),
    mimeType: String(response.headers.get('content-type') || 'audio/opus')
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