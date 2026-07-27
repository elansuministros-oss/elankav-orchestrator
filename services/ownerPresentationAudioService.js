'use strict';

const OpenAI = require('openai');
const { getOwnerPhones, normalizePhone } = require('./context/contextBuilder');

const DEFAULT_PRESENTATION_TEXT = [
  'Hola, soy ELAN IA, el asistente inteligente del ecosistema ELANKAV.',
  'Estoy aquí para ayudarte de forma rápida y sencilla.',
  'Puedo orientarte sobre rótulos, impresión, diseño, fachadas, letras 3D, viniles y otros servicios de ELANVISUAL.',
  'También puedo ayudarte con ELANHOME y con las demás plataformas activas del ecosistema ELANKAV.',
  'Podés escribirme o enviarme una nota de voz para solicitar información, una cotización o seguimiento de tu proyecto.',
  '¿En qué puedo ayudarte hoy?'
].join(' ');

const DEMO_PATTERNS = Object.freeze([
  /\b(?:muestra|demo|demostraci[oó]n)\b.*\b(?:audio|presentaci[oó]n|bienvenida)\b/i,
  /\b(?:audio|presentaci[oó]n|bienvenida)\b.*\b(?:muestra|demo|demostraci[oó]n)\b/i,
  /\b(?:env[ií]a(?:me)?|manda(?:me)?|quiero escuchar|reproduce)\b.*\b(?:audio de presentaci[oó]n|audio de bienvenida|presentaci[oó]n)\b/i,
  /^\s*\/?demo\s+(?:audio|bienvenida|presentaci[oó]n)\s*$/i
]);

function isOwnerPhone(phone) {
  const normalized = normalizePhone(phone);
  return Boolean(normalized && getOwnerPhones().includes(normalized));
}

function isOwnerPresentationDemoRequest(message) {
  const text = String(message || '').trim();
  return Boolean(text && DEMO_PATTERNS.some(pattern => pattern.test(text)));
}

function getPresentationText() {
  return String(
    process.env.ELAN_AI_PRESENTATION_TEXT || DEFAULT_PRESENTATION_TEXT
  ).trim();
}

async function generateOwnerPresentationAudio({
  text = getPresentationText(),
  openaiClient
} = {}) {
  const input = String(text || '').trim();
  if (!input) {
    const error = new Error('El texto de presentación está vacío');
    error.code = 'PRESENTATION_TEXT_REQUIRED';
    throw error;
  }

  const client = openaiClient || new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const speech = await client.audio.speech.create({
    model: process.env.ELAN_AI_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: process.env.ELAN_AI_TTS_VOICE || 'marin',
    input,
    instructions: process.env.ELAN_AI_TTS_INSTRUCTIONS ||
      'Habla en español latino, con tono cálido, profesional, natural y ligeramente enérgico. Ritmo ágil y pronunciación clara.',
    response_format: 'opus'
  });

  const buffer = Buffer.from(await speech.arrayBuffer());
  if (!buffer.length) {
    const error = new Error('OpenAI devolvió un audio vacío');
    error.code = 'PRESENTATION_AUDIO_EMPTY';
    throw error;
  }

  return Object.freeze({
    data: buffer.toString('base64'),
    mimetype: 'audio/ogg; codecs=opus',
    filename: 'elan-ia-presentacion.opus',
    text: input
  });
}

module.exports = {
  DEFAULT_PRESENTATION_TEXT,
  generateOwnerPresentationAudio,
  getPresentationText,
  isOwnerPhone,
  isOwnerPresentationDemoRequest
};
