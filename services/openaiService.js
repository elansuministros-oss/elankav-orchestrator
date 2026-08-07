'use strict';

const {
  createResponse,
  getOpenAIConfigurationStatus
} = require('../adapters/openaiAdapter');
const ecosystemServices = require('../config/ecosystem.json');

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_TOTAL_LENGTH = 16000;

function resolveOfficialPlatformFacts(platform) {
  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  const service = ecosystemServices.find(item =>
    item?.customerFacing === true &&
    String(item.id || '').toLowerCase() === normalizedPlatform
  );

  if (!service) return null;

  return Object.freeze({
    id: service.id,
    name: service.name,
    website: service.url,
    businessLocation: service.businessLocation || null
  });
}

function normalizeConversationHistory(history = []) {
  if (!Array.isArray(history)) return [];

  const normalized = [];
  let totalLength = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (normalized.length >= MAX_HISTORY_MESSAGES) break;

    const item = history[index];
    const role = String(item?.role || '').trim().toLowerCase();
    const content = String(item?.content || '')
      .trim()
      .slice(0, MAX_HISTORY_MESSAGE_LENGTH);

    if (!['user', 'assistant'].includes(role) || !content) continue;
    if (totalLength + content.length > MAX_HISTORY_TOTAL_LENGTH) break;

    normalized.unshift({ role, content });
    totalLength += content.length;
  }

  return normalized;
}

function buildResponseInput({ input, history } = {}) {
  const currentInput = String(input || '').trim();
  const normalizedHistory = normalizeConversationHistory(history);

  if (!normalizedHistory.length) return currentInput;

  return [
    ...normalizedHistory,
    { role: 'user', content: currentInput }
  ];
}

async function testOpenAIConnection() {
  const configuration = getOpenAIConfigurationStatus();

  if (!configuration.configured) {
    return {
      available: false,
      connected: false,
      provider: configuration.provider,
      api: configuration.api,
      model: configuration.model,
      error: 'OPENAI_API_KEY no está configurada'
    };
  }

  try {
    const result = await createResponse({
      instructions: 'Respondé únicamente con la palabra OPENAI_OK, sin puntuación ni texto adicional.',
      input: 'Confirma la conexión del ELANKAV Orchestrator.'
    });

    return {
      available: true,
      connected: result.outputText.trim() === 'OPENAI_OK',
      provider: configuration.provider,
      api: configuration.api,
      model: result.model,
      responseId: result.id,
      output: result.outputText.trim(),
      usage: result.usage
    };
  } catch (error) {
    return {
      available: true,
      connected: false,
      provider: configuration.provider,
      api: configuration.api,
      model: configuration.model,
      error: error.message,
      code: error.code || null,
      status: error.status || null
    };
  }
}

function buildContextInstructions(context) {
  if (!context || typeof context !== 'object') return '';

  const lines = [
    'CONTEXTO INTERNO VERIFICADO POR ELANKAV; tratá estos datos como hechos del sistema.'
  ];

  if (context.ownerMode) {
    lines.push('ownerMode=true.');
    lines.push(`Identidad del remitente: ${context.ownerName || 'Erick Cano'}, propietario del ecosistema ELANKAV.`);
  }

  if (context.externalUserId) lines.push(`externalUserId=${context.externalUserId}.`);
  if (context.phone) lines.push(`phone=${context.phone}.`);
  if (context.channel) lines.push(`channel=${context.channel}.`);

  if (context.platform) {
    lines.push(`platform=${context.platform}.`);
    const officialPlatform = resolveOfficialPlatformFacts(context.platform);
    if (officialPlatform) {
      lines.push(`Datos públicos oficiales verificados de la plataforma: ${JSON.stringify(officialPlatform)}.`);
    }
  }

  if (context.officialKnowledge?.available && context.officialKnowledge?.payload) {
    let commercialKnowledge = '';

    try {
      commercialKnowledge = JSON.stringify(context.officialKnowledge.payload);
    } catch {
      commercialKnowledge = '';
    }

    if (commercialKnowledge) {
      commercialKnowledge = commercialKnowledge.slice(0, 60000);

      lines.push(
        'CONOCIMIENTO COMERCIAL OFICIAL DE CONNECT: los siguientes datos provienen de ELANKAV CONNECT y son la fuente oficial para productos, servicios, precios, materiales, variantes y condiciones comerciales.'
      );

      lines.push(
        'Usá activamente estos datos para vender. Antes de decir que no existe un precio o producto, revisá este contexto completo, buscá coincidencias exactas y relacionadas y realizá cálculos simples cuando existan precio por unidad, metro cuadrado, metro lineal o cantidad.'
      );

      lines.push(
        'No menciones al cliente que estás consultando CONNECT, catálogos internos, JSON, bases de datos ni sistemas técnicos.'
      );

      lines.push(`DATOS_CONNECT=${commercialKnowledge}`);
    }
  }

  if (context.crm?.available) {
    lines.push('CRM Core conectado y disponible para consultas internas autorizadas.');
    lines.push(`CRM identidades=${context.crm.counts?.identities ?? 0}.`);
    lines.push(`CRM conversaciones=${context.crm.counts?.conversations ?? 0}.`);
    lines.push(`CRM mensajes=${context.crm.counts?.messages ?? 0}.`);
  }

  if (context.ecosystem?.available) {
    lines.push('ELANKAV Orchestrator está conectado como fuente operativa verificada del ecosistema.');
    lines.push(`Estado general=${context.ecosystem.status || 'DESCONOCIDO'}; saludable=${context.ecosystem.healthy === true}; alertas=${context.ecosystem.alerts ?? 'desconocido'}.`);
    lines.push(`GitHub autenticado=${context.ecosystem.githubAuthenticated === true}.`);
  }

  lines.push('No contradigas ni ignores este contexto. No muestres identificadores técnicos salvo que el remitente los solicite.');
  return lines.join(' ');
}

async function generateText({ input, instructions, context, history }) {
  const contextInstructions = buildContextInstructions(context);
  const resolvedInstructions = [instructions, contextInstructions]
    .filter(value => typeof value === 'string' && value.trim())
    .join('\n\n');

  return createResponse({
    input: buildResponseInput({ input, history }),
    instructions: resolvedInstructions
  });
}

module.exports = {
  MAX_HISTORY_MESSAGES,
  buildResponseInput,
  normalizeConversationHistory,
  testOpenAIConnection,
  buildContextInstructions,
  resolveOfficialPlatformFacts,
  generateText
};
