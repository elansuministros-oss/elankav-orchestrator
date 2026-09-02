'use strict';

const connectVoiceService = require('./connectVoiceService');

function createVoiceError(code, status, message) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeMimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

async function synthesizeSpeechOfficial({ text, fetchImpl = fetch } = {}) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) throw createVoiceError('CONNECT_SPEECH_TEXT_REQUIRED', 400);

  const { baseUrl, token } = connectVoiceService.getConnectConfig();
  if (!token) throw createVoiceError('CONNECT_VOICE_TOKEN_REQUIRED', 503);

  const response = await fetchImpl(`${baseUrl}/api/v1/voice/speech`, {
    method: 'POST',
    headers: {
      Accept: 'audio/ogg, audio/opus, audio/mpeg, audio/wav, application/json',
      'Content-Type': 'application/json',
      'X-Connect-Voice-Token': token
    },
    body: JSON.stringify({
      text: normalizedText,
      format: process.env.VOICE_SPEECH_FORMAT || 'opus'
    }),
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw createVoiceError(
      payload?.error?.code || 'CONNECT_OFFICIAL_SPEECH_FAILED',
      response.status,
      payload?.error?.message || `CONNECT Voice HTTP ${response.status}`
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    const audioBase64 = payload?.audioBase64 || payload?.data?.audioBase64 || payload?.data;
    if (!audioBase64) throw createVoiceError('CONNECT_SPEECH_EMPTY', 502);
    return {
      data: audioBase64,
      mimeType: normalizeMimeType(payload?.mimeType || payload?.data?.mimeType || 'audio/ogg')
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw createVoiceError('CONNECT_SPEECH_EMPTY', 502);
  return {
    data: buffer.toString('base64'),
    mimeType: normalizeMimeType(contentType || 'audio/ogg')
  };
}

// Speech identity belongs to CONNECT. If CONNECT Voice fails, the caller must
// use its existing TEXT fallback instead of silently synthesizing another voice.
connectVoiceService.synthesizeSpeech = synthesizeSpeechOfficial;

module.exports = { synthesizeSpeechOfficial };
