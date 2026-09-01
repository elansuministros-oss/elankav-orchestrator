'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const GENERIC_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream'
]);
const SUPPORTED_AUDIO_MIME_TYPES = new Set([
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
    internalBaseUrl: normalizeBaseUrl(
      process.env.WAHA_INTERNAL_BASE_URL || process.env.WAHA_BASE_URL,
      DEFAULT_WAHA_BASE_URL
    ),
    apiKey: String(process.env.WAHA_API_KEY || process.env.WAHA_API_TOKEN || '').trim()
  };
}

function createHttpError(code, status, message) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeMimeType(mimeType) {
  return String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function resolveAudioMimeType({ downloadedMimeType, webhookMimeType } = {}) {
  const downloaded = normalizeMimeType(downloadedMimeType);
  const webhook = normalizeMimeType(webhookMimeType);
  return GENERIC_MIME_TYPES.has(downloaded) ? webhook : downloaded;
}

function assertSupportedAudioMimeType(mimeType) {
  const normalized = normalizeMimeType(mimeType);
  if (!SUPPORTED_AUDIO_MIME_TYPES.has(normalized)) {
    throw createHttpError('VOICE_MIME_UNSUPPORTED', 415, `Unsupported voice MIME ${normalized || 'empty'}`);
  }
  return normalized;
}

function resolveMediaUrl(mediaUrl, baseUrl = getWahaConfig().baseUrl) {
  if (!String(mediaUrl || '').trim()) throw createHttpError('WAHA_MEDIA_URL_REQUIRED', 400);
  return new URL(String(mediaUrl), `${normalizeBaseUrl(baseUrl, DEFAULT_WAHA_BASE_URL)}/`).toString();
}

function isAuthorizedWahaHost(url, authorizedBaseUrls = []) {
  const target = new URL(url);
  return authorizedBaseUrls
    .filter(Boolean)
    .some(baseUrl => target.host === new URL(baseUrl).host);
}

function safeDownloadLog(event, data = {}) {
  console.log(`[${event}]`, {
    status: data.status || null,
    host: data.host || null,
    path: data.path || null,
    durationMs: data.durationMs || null,
    size: data.size || null,
    code: data.code || null
  });
}

function shouldFallback(error) {
  return (
    !error.status ||
    error.status === 401 ||
    error.status === 403 ||
    error.status >= 500
  );
}

async function fetchWahaMediaOnce({ targetUrl, authorizedBaseUrls, apiKey, fetchImpl }) {
  const startedAt = Date.now();
  const parsedUrl = new URL(targetUrl);
  const headers = { Accept: 'audio/*,application/octet-stream' };
  if (apiKey && isAuthorizedWahaHost(targetUrl, authorizedBaseUrls)) {
    headers['X-Api-Key'] = apiKey;
  }

  const response = await fetchImpl(targetUrl, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(Number(process.env.WAHA_MEDIA_TIMEOUT_MS || 30_000))
  });

  const logMeta = {
    status: response.status,
    host: parsedUrl.host,
    path: parsedUrl.pathname,
    durationMs: Date.now() - startedAt
  };

  if (!response.ok) {
    safeDownloadLog('WAHA_MEDIA_DOWNLOAD_FAILED', {
      ...logMeta,
      code: 'WAHA_MEDIA_DOWNLOAD_FAILED'
    });
    throw createHttpError(
      'WAHA_MEDIA_DOWNLOAD_FAILED',
      response.status,
      `WAHA media HTTP ${response.status}`
    );
  }

  const announcedSize = Number(response.headers.get('content-length') || 0);
  if (announcedSize > MAX_AUDIO_BYTES) {
    throw createHttpError('WAHA_MEDIA_TOO_LARGE', 413, 'WAHA media exceeds max size');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw createHttpError('WAHA_MEDIA_EMPTY', 422);
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw createHttpError('WAHA_MEDIA_TOO_LARGE', 413, 'WAHA media exceeds max size');
  }

  safeDownloadLog('WAHA_MEDIA_DOWNLOADED', {
    ...logMeta,
    size: buffer.length
  });

  return {
    buffer,
    mimeType: response.headers.get('content-type') || ''
  };
}

async function downloadWahaMedia({ url, fetchImpl = fetch }) {
  if (!url) throw createHttpError('WAHA_MEDIA_URL_REQUIRED', 400);

  const { baseUrl, internalBaseUrl, apiKey } = getWahaConfig();
  const primaryUrl = resolveMediaUrl(url, baseUrl);
  const primaryParsed = new URL(primaryUrl);
  const authorizedBaseUrls = [baseUrl, internalBaseUrl];

  safeDownloadLog('VOICE_MEDIA_DOWNLOAD_STARTED', {
    host: primaryParsed.host,
    path: primaryParsed.pathname
  });

  try {
    return await fetchWahaMediaOnce({
      targetUrl: primaryUrl,
      authorizedBaseUrls,
      apiKey,
      fetchImpl
    });
  } catch (error) {
    if (!shouldFallback(error) || !internalBaseUrl) throw error;

    const fallbackUrl = resolveMediaUrl(
      `${primaryParsed.pathname}${primaryParsed.search}`,
      internalBaseUrl
    );

    if (fallbackUrl === primaryUrl) throw error;

    const fallbackParsed = new URL(fallbackUrl);
    safeDownloadLog('VOICE_MEDIA_DOWNLOAD_FALLBACK_STARTED', {
      status: error.status || null,
      host: fallbackParsed.host,
      path: fallbackParsed.pathname,
      code: error.code || 'WAHA_MEDIA_DOWNLOAD_FAILED'
    });

    return fetchWahaMediaOnce({
      targetUrl: fallbackUrl,
      authorizedBaseUrls,
      apiKey,
      fetchImpl
    });
  }
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

function isConnectRouteUnavailable(error) {
  return error?.status === 404 || error?.code === 'ROUTE_NOT_FOUND';
}

function filenameForMime(mimeType = '') {
  const normalized = normalizeMimeType(mimeType);
  if (normalized.includes('ogg') || normalized.includes('opus')) return 'voice.ogg';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'voice.mp3';
  if (normalized.includes('wav')) return 'voice.wav';
  if (normalized.includes('webm')) return 'voice.webm';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'voice.m4a';
  return 'voice.audio';
}

async function transcribeAudioDirect({ audio, mimeType, filename }) {
  if (!process.env.OPENAI_API_KEY) {
    throw createHttpError('VOICE_CONFIGURATION_INVALID', 503, 'No transcription provider configured');
  }

  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
  const file = new File([bytes], filename || filenameForMime(mimeType), { type: mimeType });

  const result = await client.audio.transcriptions.create({
    model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1',
    file
  });

  return String(result?.text || '').trim();
}

async function transcribeAudio({ audio, mimeType, filename, fetchImpl = fetch }) {
  if (!audio?.length) throw createHttpError('CONNECT_AUDIO_REQUIRED', 400);

  const { baseUrl } = getConnectConfig();
  const normalizedMimeType = assertSupportedAudioMimeType(mimeType || 'audio/ogg');
  const form = new FormData();
  const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
  form.append('file', new Blob([bytes], { type: normalizedMimeType }), filename || filenameForMime(normalizedMimeType));
  form.append('language', 'es');

  try {
    const response = await fetchImpl(`${baseUrl}/api/v1/voice/transcriptions`, {
      method: 'POST',
      headers: buildConnectHeaders({ Accept: 'application/json' }),
      body: form,
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) throw await readConnectError(response);

    const payload = await response.json().catch(() => ({}));
    const text = String(payload?.text || payload?.data?.text || payload?.transcript || '').trim();
    if (!text) throw createHttpError('VOICE_TRANSCRIPTION_EMPTY', 502);
    return text;
  } catch (error) {
    if (!isConnectRouteUnavailable(error)) throw error;
    const text = await transcribeAudioDirect({
      audio,
      mimeType: normalizedMimeType,
      filename
    });
    if (!text) throw createHttpError('VOICE_TRANSCRIPTION_EMPTY', 502);
    return text;
  }
}

function speechMimeForFormat(format = '') {
  const normalized = String(format || '').toLowerCase();
  if (normalized === 'opus' || normalized === 'ogg') return 'audio/ogg';
  if (normalized === 'wav') return 'audio/wav';
  return 'audio/mpeg';
}

async function synthesizeSpeechDirect({ text }) {
  if (!process.env.OPENAI_API_KEY) {
    throw createHttpError('VOICE_CONFIGURATION_INVALID', 503, 'No speech provider configured');
  }

  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const format = process.env.VOICE_SPEECH_FORMAT || 'mp3';
  const response = await client.audio.speech.create({
    model: process.env.OPENAI_SPEECH_MODEL || 'gpt-4o-mini-tts',
    voice: process.env.OPENAI_SPEECH_VOICE || process.env.VOICE_SPEECH_VOICE || 'alloy',
    input: text,
    response_format: format
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw createHttpError('CONNECT_SPEECH_EMPTY', 502);

  return {
    data: buffer.toString('base64'),
    mimeType: speechMimeForFormat(format)
  };
}

async function synthesizeSpeech({ text, fetchImpl = fetch }) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) throw createHttpError('CONNECT_SPEECH_TEXT_REQUIRED', 400);

  const { baseUrl } = getConnectConfig();
  try {
    const response = await fetchImpl(`${baseUrl}/api/v1/voice/speech`, {
      method: 'POST',
      headers: buildConnectHeaders({
        Accept: 'audio/ogg, audio/opus, audio/mpeg, audio/wav',
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({ text: normalizedText, format: process.env.VOICE_SPEECH_FORMAT || 'opus' }),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) throw await readConnectError(response);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => ({}));
      const audioBase64 = payload?.audioBase64 || payload?.data?.audioBase64 || payload?.data;
      if (!audioBase64) throw createHttpError('CONNECT_SPEECH_EMPTY', 502);
      return {
        data: audioBase64,
        mimeType: normalizeMimeType(payload?.mimeType || payload?.data?.mimeType || 'audio/ogg')
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw createHttpError('CONNECT_SPEECH_EMPTY', 502);

    return {
      data: buffer.toString('base64'),
      mimeType: normalizeMimeType(contentType || 'audio/opus')
    };
  } catch (error) {
    if (!isConnectRouteUnavailable(error)) throw error;
    return synthesizeSpeechDirect({ text: normalizedText });
  }
}

module.exports = {
  MAX_AUDIO_BYTES,
  assertSupportedAudioMimeType,
  downloadWahaMedia,
  getConnectConfig,
  getWahaConfig,
  isAuthorizedWahaHost,
  normalizeMimeType,
  resolveAudioMimeType,
  resolveMediaUrl,
  synthesizeSpeech,
  transcribeAudio
};
