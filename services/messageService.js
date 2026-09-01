'use strict';

const { generateText } = require('./openaiService');
const { routeContext } = require('./context/index');
const {
  detectOwnerCommand,
  detectOwnerLanguageLearnCommand,
  executeOwnerCommand
} = require('./ownerCommandService');
const { normalizeOwnerLanguage } = require('./ownerLanguageProfileService');
const { loadCrmContext } = require('./crmContextService');
const { processCrmConversation } = require('./crmConversationService');
const { processSellerRegistrationConversation } = require('./ownerSellerRegistrationService');
const { loadEcosystemContext } = require('./ecosystemContextService');
const { loadPlatformKnowledgeSafely } = require('./connectPlatformKnowledgeService');
const {
  publishConversationEventSafely,
  requestConversationDecision
} = require('./connectConversationClient');
const { resolveCommercialActorSafely } = require('./connectActorIdentityService');
const { resolveAccessPolicy } = require('./accessPolicyService');
const { isLiveModeRequest, requestLiveSession } = require('./connectLiveAccessService');
const { loadConversationMemory } = require('./elanUnifiedRuntimeService');

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

function mergeConversationHistories(...histories) {
  const merged = [];
  const seen = new Set();
  for (const history of histories) {
    for (const item of Array.isArray(history) ? history : []) {
      const role = item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : null;
      const content = normalizeMessage(item?.content);
      if (!role || !content) continue;
      const key = `${role}\u0000${content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ role, content, createdAt: item?.createdAt || null });
    }
  }
  return merged
    .sort((a, b) => {
      const left = Date.parse(a.createdAt || '');
      const right = Date.parse(b.createdAt || '');
      if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
      return 0;
    })
    .slice(-30)
    .map(({ role, content }) => ({ role, content }));
}

function buildKnowledgeQuery(history, currentMessage) {
  const recent = Array.isArray(history) ? history.slice(-8) : [];
  return [
    ...recent.map(item => item.content),
    normalizeMessage(currentMessage)
  ].filter(Boolean).join('\n').slice(-12000);
}

function actorInstructions(actor, policy) {
  const role = String(actor?.role || policy?.role || 'prospect').toLowerCase();
  const scopes = Array.isArray(policy?.scopes) ? policy.scopes.join(', ') : '';
  const common = [
    `Identidad comercial verificada por CONNECT: ${role}.`,
    `Permisos efectivos: ${scopes || 'ninguno'}.`,
    'No concedas capacidades fuera de esos permisos y no inventes registros, precios ni estados.'
  ];

  if (role === 'seller') {
    common.push(
      'Tratá al remitente como vendedor interno, no como cliente.',
      'Puede operar solamente sus propios clientes, cotizaciones, trabajos y comisiones.',
      'Las órdenes pueden expresarse naturalmente; no exijas sintaxis técnica.'
    );
  } else if (role === 'customer') {
    common.push(
      'Tratá al remitente como cliente formal identificado por su WhatsApp registrado.',
      'Solo puede consultar/solicitar sus propios documentos y precios autorizados.',
      'No puede editar, autorizar OT, validar pagos ni pedir enlaces privados de plataforma.'
    );
  } else if (role === 'provider') {
    common.push(
      'Tratá al remitente como proveedor registrado, no como cliente ni prospecto.',
      'Solo puede consultar o aportar información correspondiente a su propia relación comercial y a sus permisos efectivos.',
      'No le concedas permisos de vendedor, cliente u Owner y no expongas información comercial de otros proveedores.'
    );
  } else {
    common.push(
      'Tratá al remitente como prospecto/no registrado.',
      'Puede recibir precios autorizados; una cotización formal requiere el flujo de autorización Owner salvo formalización por depósito.'
    );
  }

  return common.join(' ');
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
  const actor = await resolveCommercialActorSafely({
    phone: context.phone || phone || null,
    identity: context?.identity?.receivedId || externalUserId || null,
    externalUserId: context.externalUserId || externalUserId || null,
    chatId: context?.metadata?.chatId || null,
    metadata: context?.metadata || {},
    platform: platformId
  });
  const accessPolicy = resolveAccessPolicy({
    actorRole: actor?.role,
    actorScopes: actor?.scopes
  });
  let unifiedMemory = { history: [], workingState: {} };
  try {
    unifiedMemory = await loadConversationMemory({
      actor: {
        role: actor?.role || 'prospect',
        actorId: actor?.actorId || actor?.sellerId || actor?.customerId || actor?.providerId || actor?.prospectId || context.externalUserId || externalUserId || null,
        sellerId: actor?.sellerId || null,
        sellerName: actor?.displayName || null,
        registered: actor?.registered === true,
        platformAllowed: actor?.platformAllowed !== false,
        scopes: Array.isArray(actor?.scopes) ? actor.scopes : [],
        authority: actor?.authority || null,
        phone: actor?.canonicalPhone || context.phone || phone || null
      },
      platform: platformId,
      limit: 30
    });
  } catch (error) {
    console.error('[ELAN_UNIFIED_MEMORY_LOAD_FAILED]', {
      role: actor?.role || 'prospect',
      code: error?.code || null,
      message: error?.message || String(error)
    });
  }

  const history = normalizeHistory(
    mergeConversationHistories(decision.history, unifiedMemory.history),
    normalizedMessage
  );
  const knowledgeQuery = buildKnowledgeQuery(history, normalizedMessage);

  console.log('[ELAN_AI_CONTEXT_LOADED]', {
    platform: platformId,
    actorRole: actor?.role || 'prospect',
    actorAuthority: actor?.authority || null,
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
      knowledgeAvailable: false,
      actorRole: actor?.role || 'prospect'
    };
  }

  const generated = await generateText({
    input: normalizedMessage,
    history,
    instructions: [decision.instructions || '', actorInstructions(actor, accessPolicy)].filter(Boolean).join(' '),
    context: {
      ownerMode: false,
      customerMode: actor?.role === 'customer' || actor?.role === 'prospect',
      sellerMode: actor?.role === 'seller',
      providerMode: actor?.role === 'provider',
      externalUserId: context.externalUserId || externalUserId || null,
      phone: actor?.canonicalPhone || context.phone || phone || null,
      platform: platformId,
      channel: context.channel || channel || null,
      actor: {
        role: actor?.role || 'prospect',
        actorId: actor?.actorId || null,
        sellerId: actor?.sellerId || null,
        customerId: actor?.customerId || null,
        providerId: actor?.providerId || null,
        prospectId: actor?.prospectId || null,
        displayName: actor?.displayName || null,
        registered: actor?.registered === true,
        platformAllowed: actor?.platformAllowed !== false,
        authority: actor?.authority || null,
        matchedBy: actor?.matchedBy || null
      },
      accessPolicy,
      runtime: {
        schemaVersion: decision.schemaVersion || 'ELANKAV_AI_RUNTIME_V1',
        version: decision.runtimeVersion || null,
        publishedAt: decision.publishedAt || null,
        initialMessage: runtimePlatform.initialMessage || ''
      },
      officialKnowledge: knowledge,
      prospectMemory: decision.prospect || null,
      workingMemory: unifiedMemory.workingState || {}
    }
  });

  return {
    ...generated,
    status: generated.status || 'completed',
    runtimeVersion: decision.runtimeVersion || null,
    knowledgeAvailable: Boolean(knowledge?.available),
    historyMessages: history.length,
    actorRole: actor?.role || 'prospect',
    actorId: actor?.actorId || null,
    accessScopes: accessPolicy.scopes
  };
}

async function processMessage({ message, platform, channel, externalUserId, phone, metadata }) {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage) {
    const error = new Error('message es obligatorio');
    error.code = 'MESSAGE_REQUIRED';
    throw error;
  }

  let resolvedContext = null;
  const startedAt = Date.now();

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

      if (String(context.channel || channel || '').toLowerCase() === 'whatsapp' && isLiveModeRequest(normalizedMessage)) {
        try {
          const live = await requestLiveSession({
            phone: context.phone || phone || null,
            externalUserId: context.externalUserId || externalUserId || null,
            platform: context.platform || platform || 'ELANVISUAL'
          });
          return {
            outputText: `ELAN Copiloto listo. Abrí tu sesión segura:\n${live.url}\n\nLa sesión vence en 15 minutos.`,
            model: 'elankav-connect-live-access',
            id: null,
            status: 'completed',
            usage: null,
            actorRole: live.actor?.role || (ownerMode ? 'owner' : null),
            accessScopes: live.actor?.scopes || null
          };
        } catch (error) {
          if (error.code === 'LIVE_ACCESS_DENIED') {
            return {
              outputText: 'Este número no tiene acceso autorizado a ELAN Copiloto.',
              model: 'elankav-connect-live-access',
              id: null,
              status: 'denied',
              usage: null
            };
          }
          throw error;
        }
      }

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

        return processCustomerMessage({ normalizedMessage, context, platform, channel, externalUserId, phone });
      }

      const sellerConversation = await processSellerRegistrationConversation({
        message: normalizedMessage,
        externalUserId: context.externalUserId || externalUserId || null,
        phone: context.phone || phone || null,
        metadata: metadata && typeof metadata === 'object' ? metadata : {}
      });

      if (sellerConversation.handled) {
        console.log('[OWNER_SELLER_REGISTRATION]', {
          platform: context.platform || platform || 'elanvisual',
          completed: Boolean(sellerConversation.completed),
          phone: 'OWNER_RECOGNIZED'
        });
        return {
          outputText: sellerConversation.outputText,
          model: 'elankav-seller-registration',
          id: null,
          status: sellerConversation.completed ? 'completed' : 'in_progress',
          usage: null,
          crmAction: true,
          ownerCrmCommand: true
        };
      }

      const ownerLanguageLearnCommand = detectOwnerLanguageLearnCommand(normalizedMessage);
      const ownerLanguageMessage = ownerLanguageLearnCommand ? normalizedMessage : await normalizeOwnerLanguage(normalizedMessage);
      const ownerCommand = ownerLanguageLearnCommand || detectOwnerCommand(ownerLanguageMessage);
      if (ownerCommand) {
        const commandResult = await executeOwnerCommand({
          command: ownerCommand,
          platform: context.platform || platform || 'elankav',
          ownerPhone: context.phone || phone || context?.identity?.canonicalId || null
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
        loadEcosystemContext({ platform: context.platform || platform || 'ELANVISUAL', query: normalizedMessage })
      ]);

      let ownerMemory = { history: [], workingState: {} };
      try {
        ownerMemory = await loadConversationMemory({
          actor: {
            role: 'owner',
            actorId: 'owner',
            authority: 'owner_identity',
            phone: context.phone || phone || null,
            scopes: ['*'],
            platforms: ['*']
          },
          platform: context.platform || platform || 'ELANVISUAL',
          limit: 30
        });
      } catch (error) {
        console.error('[OWNER_UNIFIED_MEMORY_LOAD_FAILED]', {
          code: error?.code || null,
          message: error?.message || String(error)
        });
        commercialState = updateCommercialState({
          previousState: commercialState,
          message: normalizedMessage,
          commercial,
          platform: 'ELANVISUAL'
        });
        await savePersistentCommercialState(
          context.commercial?.stateKey,
          commercialState,
          {
            platform: 'ELANVISUAL',
            channel: context.channel || channel || 'whatsapp',
            externalUserId: context.externalUserId || externalUserId || null,
            phone: context.phone || phone || null
          }
        );

        if (commercial) {
          commercial = Object.freeze({
            ...commercial,
            persistentState: commercialState
          });
        }
      }

      return generateText({
        input: normalizedMessage,
        history: normalizeHistory(ownerMemory.history, normalizedMessage),
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
          ecosystem,
          workingMemory: ownerMemory.workingState || {}
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
    actorRole: response.actorRole || (resolvedContext?.owner?.isOwner ? 'owner' : null),
    actorId: response.actorId || null,
    accessScopes: response.accessScopes || null,
    runtimeVersion: response.runtimeVersion || null,
    knowledgeAvailable: response.knowledgeAvailable ?? null,
    historyMessages: response.historyMessages ?? null,
    context: {
      version: resolvedContext?.version || null,
      platform: resolvedContext?.platform || null,
      channel: resolvedContext?.channel || null,
      externalUserId: resolvedContext?.externalUserId || null,
      ownerMode: Boolean(resolvedContext?.owner?.isOwner),
      commercialState: response.commercialState ||
        resolvedContext?.commercial?.state ||
        null
    },
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  OWNER_INSTRUCTIONS,
  normalizeMessage,
  normalizeHistory,
  mergeConversationHistories,
  buildKnowledgeQuery,
  actorInstructions,
  checkHumanTakeover,
  processCustomerMessage,
  processMessage
};