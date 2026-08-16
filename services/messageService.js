'use strict';

const { generateText } = require('./openaiService');
const { routeContext } = require('./context/index');
const {
  detectOwnerCommand,
  detectOwnerLanguageLearnCommand,
  executeOwnerCommand
} = require('./ownerCommandService');
const {
  normalizeOwnerLanguage
} = require('./ownerLanguageProfileService');
const {
  loadCrmContext
} = require('./crmContextService');
const {
  processCrmConversation
} = require('./crmConversationService');
const {
  loadEcosystemContext
} = require('./ecosystemContextService');
const {
  loadPlatformKnowledgeSafely
} = require('./connectPlatformKnowledgeService');
const {
  publishConversationEventSafely,
  requestConversationDecision
} = require('./connectConversationClient');

const OWNER_INSTRUCTIONS = [
  'Sos el asistente ejecutivo interno de Erick Cano.',
  'El remitente fue reconocido como Erick Cano, propietario del ecosistema ELANKAV.',
  'No lo trates como cliente, lead o prospecto.',
  'No inventes datos operativos.',
  'Consultá y respetá el contexto verificado del Orchestrator antes de afirmar que una fuente no existe o no está conectada.',
  'Respondé en español, de forma directa y precisa.'
].join(' ');

function normalizeMessage(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHistory(history, currentMessage) {
  const normalized = Array.isArray(history)
    ? history
      .map(item => ({
        role: item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : null,
        content: normalizeMessage(item?.content)
      }))
      .filter(item => item.role && item.content)
    : [];

  const current = normalizeMessage(currentMessage);
  const last = normalized[normalized.length - 1];
  if (last?.role === 'user' && current && last.content === current) normalized.pop();
  return normalized;
}

function buildKnowledgeQuery(history, currentMessage) {
  const recent = Array.isArray(history) ? history.slice(-8) : [];
  return [
    ...recent.map(item => item.content),
    normalizeMessage(currentMessage)
  ].filter(Boolean).join('\n').slice(-12000);
}

async function checkHumanTakeover({
  normalizedMessage,
  platform,
  channel,
  externalUserId,
  phone,
  metadata,
  publishFn = publishConversationEventSafely
}) {
  if (String(channel || '').toLowerCase() !== 'whatsapp') return false;

  const messageId = String(metadata?.messageId || '').trim();
  const chatId = String(metadata?.chatId || externalUserId || '').trim();
  if (!messageId || !chatId) return false;

  const result = await publishFn({
    platform: platform || 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: externalUserId || null,
    phone: phone || null,
    chatId,
    direction: 'inbound',
    text: normalizedMessage,
    messageType: metadata?.messageType || 'text',
    externalMessageId: messageId,
    actorType: 'customer',
    actorName: 'WhatsApp',
    occurredAt: new Date().toISOString(),
    metadata: {
      source: 'messageService-human-takeover-check',
      session: metadata?.session || null,
      webhookMessageId: messageId,
      chatId
    }
  });

  const assignment = String(result?.assignment || '').trim().toLowerCase();
  if (assignment !== 'human') return false;

  console.log('[HUMAN_TAKEOVER_ACTIVE]', {
    platform: platform || 'ELANVISUAL',
    chatId: chatId.length > 8 ? `${chatId.slice(0, 4)}***${chatId.slice(-8)}` : '***'
  });
  return true;
}

async function processCustomerMessage({ normalizedMessage, context, platform, channel, externalUserId, phone }) {
  const decision = context?.metadata?.connectDecision || await requestConversationDecision({
    identity: externalUserId || context?.metadata?.senderRaw || context?.metadata?.chatId,
    platform: context.platform || platform || 'elanvisual',
    message: normalizedMessage,
    ownerMode: Boolean(context?.owner?.isOwner)
  });
  if (decision.action === 'PAUSED') {
    return {
      outputText: '',
      model: 'elankav-connect-runtime-disabled',
      id: null,
      status: 'automation_disabled',
      usage: null,
      suppressDelivery: true,
      runtimeVersion: decision.runtimeVersion || null
    };
  }

  const runtimePlatform = decision.platform || {};
  const platformId = runtimePlatform.platformId || context.platform || platform || 'elanvisual';
  const history = normalizeHistory(decision.history, normalizedMessage);
  const knowledgeQuery = buildKnowledgeQuery(history, normalizedMessage);

  console.log('[ELAN_AI_CONTEXT_LOADED]', {
    platform: platformId,
    historyMessages: history.length,
    knowledgeQueryLength: knowledgeQuery.length,
    conversationId: decision.conversationId || null
  });

  const knowledge = await loadPlatformKnowledgeSafely({
    platform: platformId,
    query: knowledgeQuery || normalizedMessage
  });

  if (!knowledge?.available || !knowledge?.payload) {
    console.error('[ELAN_AI_OFFICIAL_KNOWLEDGE_REQUIRED]', {
      platform: platformId,
      query: normalizedMessage,
      error: knowledge?.error || 'OFFICIAL_KNOWLEDGE_UNAVAILABLE'
    });

    return {
      outputText: [
        'En este momento no pude consultar la información oficial de',
        platformId.toUpperCase() + '.',
        'Para no darte información incorrecta, dejaré tu consulta pendiente',
        'hasta recuperar la conexión con la plataforma.'
      ].join(' '),
      model: 'elankav-official-knowledge-unavailable',
      id: null,
      status: 'knowledge_unavailable',
      usage: null,
      runtimeVersion: decision.runtimeVersion || null,
      knowledgeAvailable: false
    };
  }

  const generated = await generateText({
    input: normalizedMessage,
    history,
    instructions: decision.instructions,
    context: {
      ownerMode: false,
      customerMode: true,
      externalUserId: context.externalUserId || externalUserId || null,
      phone: context.phone || phone || null,
      platform: platformId,
      channel: context.channel || channel || null,
      runtime: {
        schemaVersion: decision.schemaVersion || 'ELANKAV_AI_RUNTIME_V1',
        version: decision.runtimeVersion || null,
        publishedAt: decision.publishedAt || null,
        initialMessage: runtimePlatform.initialMessage || ''
      },
      officialKnowledge: knowledge
      ,prospectMemory: decision.prospect || null
    }
  });

  return {
    ...generated,
    status: generated.status || 'completed',
    runtimeVersion: decision.runtimeVersion || null,
    knowledgeAvailable: Boolean(knowledge?.available),
    historyMessages: history.length
  };
}

async function processMessage({
  message,
  platform,
  channel,
  externalUserId,
  phone,
  metadata
}) {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage) {
    const error = new Error('message es obligatorio');
    error.code = 'MESSAGE_REQUIRED';
    throw error;
  }

  let resolvedContext = null;

  const response = await routeContext(
    {
      message: normalizedMessage,
      source: 'messageService',
      platform,
      channel,
      externalUserId,
      phone,
      metadata: metadata && typeof metadata === 'object' ? metadata : {}
    },
    async context => {
      resolvedContext = context;
      const ownerMode = Boolean(context.owner?.isOwner);

      if (!ownerMode) {
        const humanTakeover = metadata?.connectDecision ? false : await checkHumanTakeover({
          normalizedMessage,
          platform: context.platform || platform || 'ELANVISUAL',
          channel: context.channel || channel,
          externalUserId: context.externalUserId || externalUserId,
          phone: context.phone || phone,
          metadata
        });

        if (humanTakeover) {
          return {
            outputText: '',
            model: 'elankav-human-takeover',
            id: null,
            status: 'human_takeover',
            usage: null,
            suppressDelivery: true
          };
        }

        return processCustomerMessage({
          normalizedMessage,
          context,
          platform,
          channel,
          externalUserId,
          phone
        });
      }

      const ownerLanguageLearnCommand =
        detectOwnerLanguageLearnCommand(normalizedMessage);

      const ownerLanguageMessage = ownerLanguageLearnCommand
        ? normalizedMessage
        : await normalizeOwnerLanguage(normalizedMessage);

      const ownerCommand =
        ownerLanguageLearnCommand ||
        detectOwnerCommand(ownerLanguageMessage);
      if (ownerCommand) {
        const commandResult = await executeOwnerCommand({
          command: ownerCommand,
          platform: context.platform || platform || 'elankav'
        });

        return {
          outputText: commandResult.outputText,
          model: 'elankav-owner-command',
          id: commandResult.job?.id || null,
          status: commandResult.job?.status || 'completed',
          usage: null,
          ownerCommand: commandResult.command,
          jobId: commandResult.job?.id || null
        };
      }

      const crmConversation = await processCrmConversation({
        message: normalizedMessage,
        externalUserId: context.externalUserId || externalUserId || null,
        phone: context.phone || phone || null
      });

      if (crmConversation.handled) {
        console.log('[OWNER_CRM_COMMAND]', {
          platform: context.platform || platform || 'elanvisual',
          completed: Boolean(crmConversation.completed),
          phone: 'OWNER_RECOGNIZED'
        });

        return {
          outputText: crmConversation.outputText,
          model: 'elankav-crm-conversation',
          id: null,
          status: crmConversation.completed ? 'completed' : 'in_progress',
          usage: null,
          crmAction: true,
          ownerCrmCommand: true
        };
      }

      console.log('[OWNER_GENERAL_QUERY]', {
        platform: context.platform || platform || 'elanvisual',
        channel: context.channel || channel || null,
        phone: context.phone || phone ? 'OWNER_RECOGNIZED' : null
      });

      const [crm, ecosystem] = await Promise.all([
        loadCrmContext(),
        loadEcosystemContext({
          platform: context.platform || platform || 'ELANVISUAL',
          query: normalizedMessage
        })
      ]);

      return generateText({
        input: normalizedMessage,
        history: [],
        instructions: OWNER_INSTRUCTIONS,
        context: {
          ownerMode: true,
          customerMode: false,
          ownerName: 'Erick Cano',
          externalUserId: context.externalUserId || externalUserId || null,
          phone: context.phone || phone || null,
          platform: context.platform || platform || null,
          channel: context.channel || channel || null,
          crm,
          ecosystem
        }
      });
    }
  );

  const suppressDelivery = response.suppressDelivery === true;

  return {
    message: normalizedMessage,
    reply: suppressDelivery ? null : String(response.outputText || '').trim(),
    provider: response.ownerCommand || response.crmAction ? 'elankav' : 'openai',
    model: response.model,
    responseId: response.id,
    status: response.status,
    usage: response.usage,
    suppressDelivery,
    command: response.ownerCommand || null,
    jobId: response.jobId || null,
    ownerCommercialQuery: response.ownerCommercialQuery === true,
    ownerCrmCommand: response.ownerCrmCommand === true,
    runtimeVersion: response.runtimeVersion || null,
    knowledgeAvailable: response.knowledgeAvailable ?? null,
    historyMessages: response.historyMessages ?? null,
    context: {
      version: resolvedContext?.version || null,
      platform: resolvedContext?.platform || null,
      channel: resolvedContext?.channel || null,
      externalUserId: resolvedContext?.externalUserId || null,
      ownerMode: Boolean(resolvedContext?.owner?.isOwner)
    },
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  OWNER_INSTRUCTIONS,
  normalizeMessage,
  normalizeHistory,
  buildKnowledgeQuery,
  checkHumanTakeover,
  processCustomerMessage,
  processMessage
};
