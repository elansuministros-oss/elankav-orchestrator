'use strict';

const OpenAI = require('openai');

let client = null;

function getClient(env = process.env) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY no está configurada');
    error.code = 'OPENAI_NOT_CONFIGURED';
    throw error;
  }
  if (!client) client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
  return client;
}

function parseJson(text) {
  const raw = String(text || '').trim();
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const value = JSON.parse(cleaned);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function cleanName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 3 || name.length > 180) return '';
  return name;
}

async function extractSellerIdentityFromImage({ buffer, mimeType, env = process.env }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const error = new Error('SELLER_ID_IMAGE_REQUIRED');
    error.code = 'SELLER_ID_IMAGE_REQUIRED';
    throw error;
  }

  const type = String(mimeType || '').toLowerCase();
  if (!type.startsWith('image/')) {
    const error = new Error('SELLER_ID_IMAGE_UNSUPPORTED');
    error.code = 'SELLER_ID_IMAGE_UNSUPPORTED';
    throw error;
  }

  const model = String(env.OPENAI_VISION_MODEL || env.OPENAI_MODEL || 'gpt-4.1-mini').trim();
  const dataUrl = `data:${type};base64,${buffer.toString('base64')}`;
  const response = await getClient(env).responses.create({
    model,
    instructions: [
      'Analizás una fotografía enviada por el propietario de ELANKAV durante el alta guiada de un vendedor.',
      'Extraé únicamente datos mínimos necesarios para identificar el borrador.',
      'NO devuelvas número de cédula, fecha de nacimiento, domicilio, códigos, QR, firmas ni otros datos sensibles.',
      'Si es un documento de identidad y el nombre completo es claramente visible, devolvé dos formas: printedName exactamente en el orden visible y naturalName en orden natural de uso personal (nombres primero, apellidos después) solamente si el orden se puede inferir con alta confianza.',
      'En documentos nicaragüenses es frecuente que el documento muestre apellidos primero y nombres después; no reordenes si existe duda.',
      'No inventes caracteres ni completes nombres dudosos.',
      'Respondé únicamente JSON válido con esta forma:',
      '{"documentDetected":true,"side":"front|back|unknown","printedName":"texto o null","naturalName":"texto o null","confidence":0.0,"naturalOrderConfidence":0.0}',
      'confidence y naturalOrderConfidence deben estar entre 0 y 1.'
    ].join(' '),
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'Identificá si esta imagen corresponde a una cédula/documento de identidad y extraé solamente el nombre completo visible. Si podés inferir con alta confianza el orden natural, devolvelo también.' },
        { type: 'input_image', image_url: dataUrl }
      ]
    }]
  });

  const parsed = parseJson(response.output_text);
  const side = ['front', 'back', 'unknown'].includes(String(parsed.side || '').toLowerCase())
    ? String(parsed.side).toLowerCase()
    : 'unknown';
  const confidence = Number(parsed.confidence);
  const naturalOrderConfidence = Number(parsed.naturalOrderConfidence);
  const printedName = cleanName(parsed.printedName);
  const naturalName = cleanName(parsed.naturalName);
  const useNatural = naturalName && Number.isFinite(naturalOrderConfidence) && naturalOrderConfidence >= 0.8;

  return Object.freeze({
    documentDetected: parsed.documentDetected === true,
    side,
    printedName,
    naturalName: useNatural ? naturalName : '',
    fullName: useNatural ? naturalName : printedName,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    naturalOrderConfidence: Number.isFinite(naturalOrderConfidence) ? Math.max(0, Math.min(1, naturalOrderConfidence)) : 0,
    model: response.model || model
  });
}

module.exports = {
  extractSellerIdentityFromImage,
  parseJson
};
