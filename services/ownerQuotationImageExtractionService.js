'use strict';

const OpenAI = require('openai');
const { downloadWahaMedia } = require('./connectVoiceService');

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
  const raw = String(text || '').trim()
    .replace(/^\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`$/i, '')
    .trim();
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function clean(value, max = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('505')) return digits.slice(3);
  if (digits.length === 8) return digits;
  return '';
}

async function extractQuotationIntakeFromImage({ media, fetchImpl = fetch, env = process.env } = {}) {
  if (!media?.url) {
    const error = new Error('QUOTATION_INTAKE_IMAGE_REQUIRED');
    error.code = 'QUOTATION_INTAKE_IMAGE_REQUIRED';
    throw error;
  }

  const downloaded = await downloadWahaMedia({ url: media.url, fetchImpl });
  const buffer = Buffer.from(downloaded?.buffer || []);
  const mimeType = String(downloaded?.mimeType || media?.mimeType || media?.mimetype || 'image/jpeg')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (!buffer.length || !mimeType.startsWith('image/')) {
    const error = new Error('QUOTATION_INTAKE_IMAGE_INVALID');
    error.code = 'QUOTATION_INTAKE_IMAGE_INVALID';
    throw error;
  }

  const model = String(env.OPENAI_VISION_MODEL || env.OPENAI_MODEL || 'gpt-4.1-mini').trim();
  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
  const response = await getClient(env).responses.create({
    model,
    instructions: [
      'Analizás una captura o fotografía enviada por el propietario de ELANKAV para preparar una cotización comercial.',
      'Extraé solamente información visible y útil para identificar al cliente/prospecto y el trabajo.',
      'No inventes datos faltantes.',
      'Si no aparece un nombre de persona pero sí aparece claramente el nombre del negocio, tienda o rótulo, usá ese nombre como companyName y dejá customerName en null; el sistema decidirá si debe reutilizarlo como nombre del cliente.',
      'Si aparece un nombre de persona y un negocio, mantenelos separados.',
      'workDescription debe resumir únicamente lo visible sobre el trabajo/producto solicitado; no agregues materiales que no se vean escritos o claramente identificables.',
      'Respondé únicamente JSON válido con esta forma:',
      '{"customerName":"texto o null","companyName":"texto o null","phone":"texto o null","email":"texto o null","address":"texto o null","workDescription":"texto o null","productName":"texto o null","confidence":0.0}'
    ].join(' '),
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'Extraé los datos comerciales visibles de esta imagen para iniciar una cotización. No adivines información que no esté visible.'
        },
        { type: 'input_image', image_url: dataUrl }
      ]
    }]
  });

  const parsed = parseJson(response.output_text);
  const confidence = Number(parsed.confidence);
  return Object.freeze({
    customerName: clean(parsed.customerName, 180),
    companyName: clean(parsed.companyName, 180),
    phone: normalizePhone(parsed.phone),
    email: clean(parsed.email, 320).toLowerCase(),
    address: clean(parsed.address, 1000),
    workDescription: clean(parsed.workDescription, 2000),
    productName: clean(parsed.productName, 500),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    model: response.model || model
  });
}

module.exports = {
  extractQuotationIntakeFromImage,
  normalizePhone,
  parseJson
};
