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

function verifiedActorValue(value, maxLength = 160) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeIntentText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s?¿!¡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectVerifiedIdentityQuestion(input) {
  const text = normalizeIntentText(input);
  if (!text) return false;

  return /(?:^|\s)(?:quien soy|sabes quien soy|sabes quien soy yo|decime quien soy|dime quien soy|como estoy registrado|como estoy registrada|que rol tengo|cual es mi rol|me reconoces)(?:\s|[?¿!¡]|$)/i.test(text);
}

function detectVerifiedActivationRequest(input) {
  const text = normalizeIntentText(input);
  if (!text) return false;

  return /^(?:elan\s+)?(?:activate|activa|activame|activar)(?:\s+elan)?[?¿!¡]*$/i.test(text);
}

function verifiedRoleLabel(role) {
  const normalizedRole = verifiedActorValue(role, 40).toLowerCase();
  const labels = {
    seller: 'vendedor interno',
    provider: 'proveedor registrado',
    customer: 'cliente registrado',
    family: 'miembro autorizado de familia'
  };

  return labels[normalizedRole] || normalizedRole || 'usuario registrado';
}

function buildVerifiedActorDirectResponse({ input, context } = {}) {
  const actor = context?.actor && typeof context.actor === 'object'
    ? context.actor
    : null;

  if (!actor || actor.registered !== true) return null;

  const actorName = verifiedActorValue(actor.displayName, 160);
  const actorRole = verifiedActorValue(actor.role, 40).toLowerCase();

  if (!actorName || !actorRole) return null;

  const identityQuestion = detectVerifiedIdentityQuestion(input);
  const activationRequest = detectVerifiedActivationRequest(input);

  if (!identityQuestion && !activationRequest) return null;

  const platform = verifiedActorValue(context?.platform || 'ELANVISUAL', 80).toUpperCase();
  const roleLabel = verifiedRoleLabel(actorRole);

  if (activationRequest) {
    return `✅ ELAN activada para ${actorName}. Te reconozco como ${roleLabel} de ${platform}. Voy a trabajar con los permisos asociados a tu cuenta y con tus registros autorizados. ¿Qué querés hacer ahora?`;
  }

  return `Sos ${actorName}. Te tengo registrado en ${platform} con rol de ${roleLabel}. Tu identidad está verificada y voy a trabajar con los permisos asociados a tu cuenta.`;
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

  const actor = context.actor && typeof context.actor === 'object'
    ? context.actor
    : null;

  if (actor) {
    const actorRole = verifiedActorValue(actor.role, 40).toLowerCase();
    const actorName = verifiedActorValue(actor.displayName, 160);
    const actorAuthority = verifiedActorValue(actor.authority, 80);
    const actorRegistered = actor.registered === true;

    if (actorRole) {
      lines.push(`Rol comercial verificado por CONNECT: ${actorRole}.`);
    }

    if (actorName) {
      lines.push(`Nombre verificado del remitente: ${actorName}.`);
    }

    if (actorRegistered) {
      lines.push('El remitente está registrado oficialmente en la autoridad comercial correspondiente.');
    }

    if (actorAuthority) {
      lines.push(`Autoridad de identidad verificada: ${actorAuthority}.`);
    }

    if (actorName && actorRole && actorRegistered) {
      lines.push(
        `En conversaciones normales, tratá al remitente explícitamente como ${actorName} con rol ${actorRole} cuando sea relevante. No respondas únicamente con una etiqueta genérica como “vendedor interno” cuando existe un nombre verificado.`
      );
    }
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
  const verifiedActorResponse = buildVerifiedActorDirectResponse({ input, context });

  if (verifiedActorResponse) {
    return {
      outputText: verifiedActorResponse,
      model: 'elankav-verified-actor',
      id: null,
      status: 'completed',
      usage: null
    };
  }

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
  verifiedActorValue,
  normalizeIntentText,
  detectVerifiedIdentityQuestion,
  detectVerifiedActivationRequest,
  verifiedRoleLabel,
  buildVerifiedActorDirectResponse,
  generateText
};
