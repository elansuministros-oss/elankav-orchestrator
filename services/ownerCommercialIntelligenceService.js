'use strict';

const { createToolResponse } = require('../adapters/openaiAdapter');
const {
  createConnectCommercialIntelligenceAdapter
} = require('../adapters/connectCommercialIntelligenceAdapter');

const OWNER_TIME_ZONE = 'America/Managua';
const MANAGUA_OFFSET = '-06:00';
const MAX_TOOL_ROUNDS = 2;

const FILTER_PROPERTIES = Object.freeze({
  from: { type: 'string', description: 'Fecha/hora ISO inicial, opcional.' },
  to: { type: 'string', description: 'Fecha/hora ISO final, opcional.' },
  business_unit: { type: 'string', description: 'Unidad de negocio, por ejemplo ELANVISUAL o ELANPET.' },
  platform: { type: 'string', description: 'Plataforma comercial, opcional.' },
  channel: { type: 'string', description: 'whatsapp, email, messenger, instagram_dm, etc.' },
  source: { type: 'string', description: 'Origen comercial, opcional.' },
  campaign: { type: 'string', description: 'Campaña específica, opcional.' }
});

const COMMERCIAL_BRIEFING_TOOL = Object.freeze({
  type: 'function',
  name: 'get_commercial_briefing',
  description: 'Consulta CONNECT para pendientes, seguimientos, conversaciones que requieren respuesta y casos que conviene que atienda personalmente el Owner.',
  parameters: {
    type: 'object',
    properties: FILTER_PROPERTIES,
    additionalProperties: false
  }
});

const COMMERCIAL_REPORT_TOOL = Object.freeze({
  type: 'function',
  name: 'get_commercial_report',
  description: 'Consulta CONNECT para conteos y rendimiento: mensajes recibidos/enviados, conversaciones, respuestas de ELAN, respuestas humanas, cotizaciones y métricas por período.',
  parameters: {
    type: 'object',
    properties: FILTER_PROPERTIES,
    additionalProperties: false
  }
});

const COMMERCIAL_TOOLS = Object.freeze([
  COMMERCIAL_BRIEFING_TOOL,
  COMMERCIAL_REPORT_TOOL
]);

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@._\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeCommercialIntelligenceQuery(value) {
  const text = normalizeText(value);
  if (!text) return false;

  const operationalSubject =
    /\b(mensaje|mensajes|correo|correos|email|emails|pendiente|pendientes|respuesta|respuestas|responder|seguimiento|seguimientos|cliente|clientes|conversacion|conversaciones|rendimiento|negocio|ventas|cotizacion|cotizaciones|campana|campanas|whatsapp|wasap|wsp|messenger|instagram|atender|atencion)\b/.test(text);

  if (!operationalSubject) return false;

  const operationalQuestion =
    /\b(cuantos?|cuantas?|que|quien|quienes|como|cual|cuales|decime|dime|mostra|mostrar|muestra|revisa|revisar|resume|resumen|hoy|ayer|semana|mes|pendiente|pendientes|sin respuesta|atender|atencion|rendimiento|recibimos|recibi|llegaron|entraron|respondio|respondieron)\b/.test(text);

  return operationalQuestion;
}

function datePartsInManagua(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: OWNER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const read = type => parts.find(part => part.type === type)?.value || '';
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day'))
  };
}

function localIsoAt(parts, time) {
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return new Date(`${year}-${month}-${day}T${time}${MANAGUA_OFFSET}`).toISOString();
}

function shiftLocalDate(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function startOfWeekParts(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = date.getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return shiftLocalDate(parts, -daysFromMonday);
}

function deriveFallbackFilters(value, now = new Date()) {
  const text = normalizeText(value);
  const filters = {};
  const today = datePartsInManagua(now);

  if (/\b(correo|correos|email|emails)\b/.test(text)) filters.channel = 'email';
  else if (/\b(whatsapp|wasap|wsp)\b/.test(text)) filters.channel = 'whatsapp';
  else if (/\b(instagram|instagram dm)\b/.test(text)) filters.channel = 'instagram_dm';
  else if (/\b(messenger|facebook messenger)\b/.test(text)) filters.channel = 'messenger';

  if (/\belanvisual\b/.test(text)) filters.businessUnit = 'ELANVISUAL';
  else if (/\belanpet\b/.test(text)) filters.businessUnit = 'ELANPET';
  else if (/\belan\s+go\b/.test(text)) filters.businessUnit = 'ELAN GO';

  if (/\bhoy\b/.test(text)) {
    filters.from = localIsoAt(today, '00:00:00');
    filters.to = now.toISOString();
  } else if (/\bayer\b/.test(text)) {
    const yesterday = shiftLocalDate(today, -1);
    filters.from = localIsoAt(yesterday, '00:00:00');
    filters.to = localIsoAt(yesterday, '23:59:59.999');
  } else if (/\besta semana\b|\bsemana actual\b/.test(text)) {
    filters.from = localIsoAt(startOfWeekParts(today), '00:00:00');
    filters.to = now.toISOString();
  } else if (/\beste mes\b|\bmes actual\b/.test(text)) {
    filters.from = localIsoAt({ year: today.year, month: today.month, day: 1 }, '00:00:00');
    filters.to = now.toISOString();
  } else {
    const daysMatch = text.match(/\b(?:ultimos?|ultimas?)\s+(\d{1,2})\s+dias?\b/);
    if (daysMatch) {
      const days = Math.max(1, Math.min(Number(daysMatch[1]) || 1, 90));
      filters.from = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)).toISOString();
      filters.to = now.toISOString();
    }
  }

  return filters;
}

function filtersFromToolArguments(args = {}) {
  return {
    ...(args.from ? { from: String(args.from) } : {}),
    ...(args.to ? { to: String(args.to) } : {}),
    ...(args.business_unit ? { businessUnit: String(args.business_unit) } : {}),
    ...(args.platform ? { platform: String(args.platform) } : {}),
    ...(args.channel ? { channel: String(args.channel) } : {}),
    ...(args.source ? { source: String(args.source) } : {}),
    ...(args.campaign ? { campaign: String(args.campaign) } : {})
  };
}

function safeJsonParse(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatReport(payload = {}) {
  const summary = payload.summary || {};
  const range = payload.range || {};
  const pieces = [
    `En el período consultado hay ${Number(summary.conversations || 0)} conversaciones`,
    `${Number(summary.inboundMessages || 0)} mensajes recibidos`,
    `${Number(summary.outboundMessages || 0)} mensajes enviados`,
    `${Number(summary.elanResponses || 0)} respuestas de ELAN`,
    `${Number(summary.humanResponses || 0)} respuestas humanas`
  ];

  if (summary.awaitingUs !== undefined) pieces.push(`${Number(summary.awaitingUs || 0)} requieren respuesta nuestra`);
  if (summary.followUpDue !== undefined) pieces.push(`${Number(summary.followUpDue || 0)} seguimientos vencidos o para atender`);
  if (summary.ownerRecommended !== undefined) pieces.push(`${Number(summary.ownerRecommended || 0)} casos recomendados para atención personal`);
  if (summary.quotesCreated !== undefined) pieces.push(`${Number(summary.quotesCreated || 0)} cotizaciones creadas`);

  const prefix = range.from && range.to
    ? `Datos verificados de CONNECT entre ${range.from} y ${range.to}: `
    : 'Datos verificados de CONNECT: ';

  return prefix + pieces.join(', ') + '.';
}

function formatBriefing(payload = {}) {
  if (String(payload.text || '').trim()) return String(payload.text).trim();

  const counts = payload.counts || {};
  return [
    `Tenés ${Number(counts.total || 0)} conversaciones en el período consultado.`,
    `${Number(counts.awaitingUs || 0)} requieren respuesta nuestra.`,
    `${Number(counts.awaitingCustomer || 0)} están esperando al cliente.`,
    `${Number(counts.ownerRecommended || 0)} recomiendo que las atendás personalmente.`,
    `${Number(counts.highOrUrgent || 0)} tienen prioridad alta o urgente.`
  ].join(' ');
}

function fallbackResourceForQuery(value) {
  const text = normalizeText(value);
  return /\b(pendiente|pendientes|sin respuesta|seguimiento|atender|atencion|personalmente|urgente|prioridad|quien|quienes)\b/.test(text)
    ? 'briefing'
    : 'report';
}

function toolInstructions({ now = new Date(), extra = '' } = {}) {
  return [
    'Sos ELAN consultando datos operativos reales para el Owner.',
    'Para esta pregunta DEBÉS consultar CONNECT antes de responder; no respondas con memoria ni inventes cifras.',
    'Usá get_commercial_report para conteos de mensajes, actividad, rendimiento, cotizaciones y métricas.',
    'Usá get_commercial_briefing para pendientes, conversaciones sin respuesta, seguimiento, prioridad y atención personal del Owner.',
    `Zona horaria operativa: ${OWNER_TIME_ZONE}. Momento actual del servidor: ${now.toISOString()}.`,
    'Interpretá hoy, ayer, esta semana y este mes respecto a esa zona horaria.',
    'Si el usuario menciona correo/email, WhatsApp, Messenger o Instagram, aplicá el filtro channel correspondiente.',
    'Respondé en español, directo, sin mostrar tokens, IDs internos innecesarios ni detalles técnicos.',
    String(extra || '').trim()
  ].filter(Boolean).join(' ');
}

async function executeToolCall(call, adapter) {
  const args = safeJsonParse(call?.arguments);
  const filters = filtersFromToolArguments(args);
  const name = String(call?.name || '').trim();

  if (name === 'get_commercial_briefing') {
    return {
      name,
      payload: await adapter.getBriefing(filters)
    };
  }

  if (name === 'get_commercial_report') {
    return {
      name,
      payload: await adapter.getReport(filters)
    };
  }

  const error = new Error(`Herramienta comercial no autorizada: ${name || 'sin nombre'}`);
  error.code = 'OWNER_COMMERCIAL_TOOL_NOT_ALLOWED';
  throw error;
}

function conversationInput(input, history = []) {
  const current = String(input || '').trim();
  const safeHistory = Array.isArray(history)
    ? history
      .slice(-10)
      .map(item => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        content: String(item?.content || '').trim()
      }))
      .filter(item => item.content)
    : [];

  return safeHistory.length
    ? [...safeHistory, { role: 'user', content: current }]
    : current;
}

async function answerOwnerCommercialQuery({
  input,
  history = [],
  instructions = '',
  now = new Date(),
  adapter = createConnectCommercialIntelligenceAdapter(),
  createToolResponseImpl = createToolResponse
} = {}) {
  if (!looksLikeCommercialIntelligenceQuery(input)) {
    return { handled: false, outputText: '' };
  }

  const resolvedInstructions = toolInstructions({ now, extra: instructions });
  let response = await createToolResponseImpl({
    input: conversationInput(input, history),
    instructions: resolvedInstructions,
    tools: COMMERCIAL_TOOLS
  });

  let lastExecution = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const calls = Array.isArray(response?.output)
      ? response.output.filter(item => item?.type === 'function_call')
      : [];

    if (!calls.length) {
      if (lastExecution) {
        return {
          handled: true,
          outputText: String(response?.outputText || '').trim() ||
            (lastExecution.name === 'get_commercial_briefing'
              ? formatBriefing(lastExecution.payload)
              : formatReport(lastExecution.payload)),
          model: response?.model || 'elankav-owner-commercial-intelligence',
          id: response?.id || null,
          status: response?.status || 'completed',
          usage: response?.usage || null,
          tool: lastExecution.name
        };
      }
      break;
    }

    const outputs = [];
    for (const call of calls) {
      lastExecution = await executeToolCall(call, adapter);
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify({ ok: true, result: lastExecution.payload })
      });
    }

    response = await createToolResponseImpl({
      input: outputs,
      instructions: resolvedInstructions,
      tools: COMMERCIAL_TOOLS,
      previousResponseId: response?.id
    });
  }

  // Fail-safe: si el modelo no llamó la herramienta, la consulta sigue siendo
  // verificable y de solo lectura. Se ejecuta la ruta determinística mínima.
  const filters = deriveFallbackFilters(input, now);
  const resource = fallbackResourceForQuery(input);
  const payload = resource === 'briefing'
    ? await adapter.getBriefing(filters)
    : await adapter.getReport(filters);

  return {
    handled: true,
    outputText: resource === 'briefing' ? formatBriefing(payload) : formatReport(payload),
    model: 'elankav-owner-commercial-intelligence-fallback',
    id: null,
    status: 'completed',
    usage: null,
    tool: resource === 'briefing' ? 'get_commercial_briefing' : 'get_commercial_report'
  };
}

module.exports = {
  OWNER_TIME_ZONE,
  COMMERCIAL_BRIEFING_TOOL,
  COMMERCIAL_REPORT_TOOL,
  COMMERCIAL_TOOLS,
  MAX_TOOL_ROUNDS,
  answerOwnerCommercialQuery,
  conversationInput,
  datePartsInManagua,
  deriveFallbackFilters,
  executeToolCall,
  fallbackResourceForQuery,
  filtersFromToolArguments,
  formatBriefing,
  formatReport,
  looksLikeCommercialIntelligenceQuery,
  normalizeText,
  toolInstructions
};
