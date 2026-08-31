'use strict';

const { createResponse } = require('../adapters/openaiAdapter');
const { BUSINESS_COMMANDS } = require('./ownerBusinessCommandService');

const ALLOWED_INTENTS = new Set([
  'quotation_list_by_customer',
  'quotation_lookup',
  'quotation_latest',
  'quotation_recent',
  'quotation_split',
  'quotation_send_split',
  'unknown'
]);

const COMMERCIAL_HINT = /\b(cotiz|cliente|proveedor|provedor|precio|producto|proyecto|alternativa|propuesta|envia|enviar|manda|mandar|divide|dividir|busca|buscar|muestra|mostrar|lista|listar|ultim|ambas|esas|estas|mandasela|mandaselas|enviasela|enviaselas)\b/i;

function clean(value, maxLength = 160) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeHistory(history = [], currentMessage = '') {
  if (!Array.isArray(history)) return [];
  const current = clean(currentMessage, 1000).toLowerCase();
  return history
    .map(entry => {
      const direction = clean(entry?.direction, 30).toLowerCase();
      const rawRole = clean(entry?.role, 30).toLowerCase();
      const role = ['user', 'assistant'].includes(rawRole)
        ? rawRole
        : direction === 'inbound'
          ? 'user'
          : direction === 'outbound'
            ? 'assistant'
            : '';
      const content = clean(entry?.content ?? entry?.text, 1200);
      return { role, content };
    })
    .filter(entry => entry.role && entry.content)
    .filter((entry, index, all) => {
      if (index !== all.length - 1) return true;
      return !(entry.role === 'user' && entry.content.toLowerCase() === current);
    })
    .slice(-12);
}

function shouldResolveOwnerSemanticIntent(message, history = []) {
  const text = clean(message, 1200);
  if (!text) return false;
  if (QUOTATION_HINT.test(text)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  return normalizeHistory(history, message).slice(-8).some(entry => QUOTATION_HINT.test(entry.content));
}

function extractJsonObject(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function normalizeSemanticIntent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const intent = clean(value.intent, 80);
  if (!ALLOWED_INTENTS.has(intent)) return null;
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const expectedCountRaw = Number(value.expectedCount);
  return {
    intent,
    confidence,
    customerReference: clean(value.customerReference, 120) || null,
    providerReference: clean(value.providerReference, 120) || null,
    query: clean(value.query, 240) || null,
    expectedCount: Number.isInteger(expectedCountRaw) && expectedCountRaw > 0 ? expectedCountRaw : null,
    usesContext: value.usesContext === true
  };
}

function semanticIntentToBusinessCommand(semantic) {
  if (!semantic || semantic.confidence < 0.78) return null;

  switch (semantic.intent) {
    case 'quotation_list_by_customer':
      return semantic.customerReference
        ? { type: BUSINESS_COMMANDS.QUOTATION_CUSTOMER_LIST, customerReference: semantic.customerReference }
        : null;
    case 'quotation_lookup':
      return semantic.customerReference
        ? { type: BUSINESS_COMMANDS.QUOTATION_LOOKUP, customerReference: semantic.customerReference }
        : null;
    case 'quotation_latest':
      return { type: BUSINESS_COMMANDS.QUOTATION_LATEST, limit: 1 };
    case 'quotation_recent':
      return { type: BUSINESS_COMMANDS.QUOTATION_RECENT, limit: semantic.expectedCount || 5 };
    case 'quotation_split':
      return {
        type: BUSINESS_COMMANDS.QUOTATION_CREATE,
        input: {
          splitActive: true,
          splitMode: 'per_item',
          requestedParts: semantic.expectedCount || null,
          message: semantic.query || ''
        }
      };
    case 'quotation_send_split':
      return {
        type: BUSINESS_COMMANDS.QUOTATION_SPLIT_SEND,
        ...(semantic.expectedCount ? { expectedCount: semantic.expectedCount } : {}),
        ...(semantic.customerReference ? { customerReference: semantic.customerReference } : {})
      };
    default:
      return null;
  }
}

async function resolveOwnerSemanticIntent({ message, history = [] } = {}) {
  const current = clean(message, 1200);
  if (!current) return null;

  const normalizedHistory = normalizeHistory(history, current);
  const transcript = normalizedHistory.map(entry =>
    `${entry.role === 'user' ? 'OWNER' : 'ELAN'}: ${entry.content}`
  ).join('\n');

  const instructions = [
    'Sos un clasificador de intención operacional para el Owner de ELANKAV.',
    'Tu única tarea es interpretar la intención real del OWNER usando el mensaje actual y el historial reciente.',
    'No ejecutes acciones, no respondas al usuario y no inventes datos.',
    'Las respuestas anteriores de ELAN pueden contener errores de routing. NO las uses para reemplazar la intención expresada por el OWNER.',
    'Cuando el mensaje actual sea corto o elíptico (por ejemplo “POLARIZADO”, “mandáselas”, “esas no, las últimas”), recuperá del historial el objeto y la acción pendientes si son inequívocos.',
    'Diferenciá claramente: pedir cotizaciones de un cliente NO es pedir la lista de clientes; cotización NO es proyecto.',
    'Si pide varias cotizaciones de un cliente, usá quotation_list_by_customer.',
    'Si pide una cotización concreta de un cliente, usá quotation_lookup.',
    'Si pide dividir/separar la cotización activa, usá quotation_split.',
    'Si pide enviar ambas/dos/las alternativas ya divididas, usá quotation_send_split.',
    'Si no hay suficiente evidencia, usá unknown con confianza baja.',
    'INTENTS permitidos: quotation_list_by_customer, quotation_lookup, quotation_latest, quotation_recent, quotation_split, quotation_send_split, unknown.',
    'Respondé SOLO JSON válido, sin markdown, con esta forma:',
    '{"intent":"unknown","confidence":0.0,"customerReference":null,"providerReference":null,"query":null,"expectedCount":null,"usesContext":false}.'
  ].join(' ');

  const input = [
    transcript ? `HISTORIAL RECIENTE:\n${transcript}\n` : '',
    `MENSAJE ACTUAL DEL OWNER:\n${current}`
  ].filter(Boolean).join('\n');

  try {
    const response = await createResponse({
      input,
      instructions,
      reasoningEffort: 'low'
    });
    return normalizeSemanticIntent(extractJsonObject(response.outputText));
  } catch (error) {
    console.error('[OWNER_SEMANTIC_INTENT_FAILED]', {
      code: error?.code || null,
      message: error?.message || String(error)
    });
    return null;
  }
}

module.exports = {
  ALLOWED_INTENTS,
  QUOTATION_HINT,
  clean,
  extractJsonObject,
  normalizeHistory,
  normalizeSemanticIntent,
  resolveOwnerSemanticIntent,
  semanticIntentToBusinessCommand,
  shouldResolveOwnerSemanticIntent
};
