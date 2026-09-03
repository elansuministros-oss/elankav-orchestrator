const { generateText } = require('./openaiService');
const { routeContext } = require('./context/index');
const {
  detectOwnerCommand,
  executeOwnerCommand
} = require('./ownerCommandService');
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
  loadCommercialContext,
  savePersistentCommercialState,
  updateCommercialState
} = require('./commercialContextService');
const {
  applyVerifiedCommercialReply
} = require('./commercialReplyService');
const {
  buildDesignConversationPrompt,
  detectConversationDesignIntent,
  shouldRequestLogo
} = require('./designIntentService');
const {
  processDesignRequest
} = require('./designEngineService');
const {
  processDesignFollowup
} = require('./designFollowupService');
const {
  loadConnectAiRuntimeSafely
} = require('./connectAiRuntimeService');

const OWNER_INSTRUCTIONS = [
  'Sos el asistente ejecutivo interno de Erick Cano.',
  'El remitente fue reconocido como Erick Cano, propietario del ecosistema ELANKAV.',
  'No lo trates como cliente, lead o prospecto.',
  'Si pregunta quién es para el sistema, respondé que es Erick Cano, propietario del ecosistema ELANKAV.',
  'No inventes datos operativos.',
  'Consultá y respetá el contexto verificado del Orchestrator antes de afirmar que una fuente no existe o no está conectada.',
  'Las órdenes técnicas autorizadas se procesan mediante el router owner y el pipeline seguro del Orchestrator.',
  'Nunca afirmes que un cambio fue desplegado si solamente se creó un job, una rama o un Pull Request.',
  'Cuando una respuesta requiera datos internos no incluidos en el contexto verificado, indicá claramente que esa fuente específica todavía no fue expuesta por el Orchestrator.',
  'Respondé en español, de forma directa y precisa.'
].join(' ');

function normalizeMessage(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function buildRuntimeInstructions(runtime) {
  const platform = runtime?.platform && typeof runtime.platform === 'object'
    ? runtime.platform
    : {};
  const responseRules = platform.responseRules && typeof platform.responseRules === 'object'
    ? platform.responseRules
    : {};
  const websiteInvitation = responseRules.websiteInvitation && typeof responseRules.websiteInvitation === 'object'
    ? responseRules.websiteInvitation
    : {};
  const designRequest = responseRules.designRequest && typeof responseRules.designRequest === 'object'
    ? responseRules.designRequest
    : {};

  const lines = [
    'AUTORIDAD DE COMPORTAMIENTO: CONNECT /console/ai-platforms.',
    platform.initialMessage
      ? `IDENTIDAD PUBLICADA: ${String(platform.initialMessage).trim()}`
      : null,
    platform.instructions
      ? `INSTRUCCIONES PUBLICADAS: ${String(platform.instructions).trim()}`
      : null,
    `REGLAS PUBLICADAS: ${JSON.stringify(responseRules)}.`,
    websiteInvitation.enabled === true && websiteInvitation.url
      ? `INVITACIÓN WEB HABILITADA: URL=${websiteInvitation.url}; texto=${String(websiteInvitation.text || '').trim() || 'sin texto personalizado'}.`
      : 'INVITACIÓN WEB DESHABILITADA.',
    designRequest.enabled === true && designRequest.url
      ? `SOLICITUD DE DISEÑO HABILITADA: URL=${designRequest.url}; texto=${String(designRequest.text || '').trim() || 'sin texto personalizado'}.`
      : 'SOLICITUD DE DISEÑO POR ENLACE DESHABILITADA.',
    'No sustituyas esta identidad ni estas reglas con una configuración comercial alternativa del Orchestrator.'
  ].filter(Boolean);

  return lines.join('\n\n');
}

function resolveMessageInstructions({
  ownerMode,
  customInstructions,
  runtime
}) {
  if (ownerMode) {
    const normalizedCustom = normalizeMessage(customInstructions);
    return normalizedCustom || OWNER_INSTRUCTIONS;
  }

  return buildRuntimeInstructions(runtime);
}

function resolveRuntimeHistory(runtime, history) {
  const continuity = runtime?.platform?.continuity && typeof runtime.platform.continuity === 'object'
    ? runtime.platform.continuity
    : {};

  if (continuity.enabled === false) return [];

  const source = Array.isArray(history) ? history : [];
  const requestedLimit = Number(continuity.historyLimit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 20)
    : 12;

  return source.slice(-limit);
}

function runtimeCatalogEnabled(runtime) {
  const catalogAccess = runtime?.platform?.catalogAccess;
  if (!catalogAccess || typeof catalogAccess !== 'object') return true;
  return catalogAccess.enabled !== false;
}

function buildDesignPortalLink({ runtime } = {}) {
  const designRequest = runtime?.platform?.responseRules?.designRequest;
  if (!designRequest || typeof designRequest !== 'object') return null;
  if (designRequest.enabled !== true) return null;

  const url = normalizeMessage(designRequest.url);
  return /^https:\/\//i.test(url) ? url : null;
}

function buildDesignPortalText({ runtime, link } = {}) {
  const configured = normalizeMessage(runtime?.platform?.responseRules?.designRequest?.text);
  if (configured) return configured;
  return `Completá tu solicitud de diseño en el sitio oficial de ELANVISUAL:\n${link}\n\nAl enviarla recibirás un código de seguimiento.`;
}

async function handleDesignIntent({
  message,
  context = {},
  platform,
  channel,
  externalUserId,
  phone,
  metadata,
  aiRuntime
} = {}) {
  const history = Array.isArray(metadata?.conversationHistory)
    ? metadata.conversationHistory
    : [];
  const references = Array.isArray(metadata?.references)
    ? metadata.references
    : [];
  const brandAssets = Array.isArray(metadata?.brandAssets)
    ? metadata.brandAssets
    : [];
  const detection = detectConversationDesignIntent({
    message,
    history,
    references,
    brandAssets
  });

  if (!detection.detected) {
    return {
      handled: false,
      detection
    };
  }

  const resolvedPlatform =
    context.platform || platform || null;

  if (!resolvedPlatform) {
    return {
      handled: false,
      detection,
      reason: 'DESIGN_PLATFORM_REQUIRED'
    };
  }

  const resolvedChannel = context.channel || channel || null;
  const link = buildDesignPortalLink({ runtime: aiRuntime });
  const usePortal =
    Boolean(link) &&
    String(resolvedChannel || '').toLowerCase() === 'whatsapp' &&
    metadata?.designPortalBypass !== true;

  if (usePortal) {
    return {
      outputText: buildDesignPortalText({ runtime: aiRuntime, link }),
      model: 'elankav-design-portal',
      id: null,
      status: 'needs_information',
      usage: null,
      designAction: true,
      design: null,
      handled: true,
      detection,
      designPortalUrl: link
    };
  }

  if (shouldRequestLogo({ detection })) {
    return {
      outputText: 'Para preparar la propuesta visual, enviame el logo como imagen. Si no lo tenés, respondé “sin logo” y la genero con el nombre y los datos que ya me diste.',
      model: 'elankav-design-intake',
      id: null,
      status: 'needs_information',
      usage: null,
      designAction: true,
      design: null,
      handled: true,
      detection
    };
  }

  const designMessage = buildDesignConversationPrompt({
    message,
    history,
    noLogoReply: detection.noLogoReply
  });

  const designResponse = await processDesignRequest({
    requestId:
      context.requestId ||
      metadata?.requestId ||
      null,
    identityId:
      context.externalUserId ||
      externalUserId ||
      null,
    phone:
      context.phone ||
      phone ||
      null,
    platform: resolvedPlatform,
    channel:
      context.channel ||
      channel ||
      null,
    message: designMessage,
    projectType: metadata?.projectType,
    environment: metadata?.environment || null,
    measurements: Array.isArray(metadata?.measurements)
      ? metadata.measurements
      : [],
    measurementStatus: metadata?.measurementStatus || 'MISSING',
    brandAssets,
    references,
    instructions: Array.isArray(metadata?.instructions)
      ? metadata.instructions
      : [],
    materials: Array.isArray(metadata?.materials)
      ? metadata.materials
      : [],
    lighting: metadata?.lighting || null
  });

  const designResult = designResponse.designResult;
  const processed = designResponse.processed === true;

  return {
    outputText: designResponse.outputText,
    model: designResponse.connected
      ? 'elankav-design-engine-http'
      : 'elankav-design-engine-stub',
    id:
      designResult?.designId ||
      designResponse.result?.requestId ||
      null,
    status: processed
      ? 'processed'
      : designResult?.status === 'NEEDS_INFORMATION'
        ? 'needs_information'
        : 'accepted',
    usage: null,
    designAction: true,
    design: designResult
      ? {
          designId: designResult.designId || null,
          status: designResult.status,
          clientReady:
            designResult.elanIaResult?.clientReady === true,
          conversational:
            designResult.elanIaResult?.conversational === true,
          assets: Array.isArray(designResult.assets)
            ? designResult.assets
            : [],
          qa: designResult.qa || null
        }
      : null,
    handled: true
  };
}

async function processMessage({
  message,
  instructions,
  platform,
  channel,
  externalUserId,
  phone,
  metadata
}) {
  const hasDesignMedia =
    (Array.isArray(metadata?.references) && metadata.references.length > 0) ||
    (Array.isArray(metadata?.brandAssets) && metadata.brandAssets.length > 0);
  const normalizedMessage =
    normalizeMessage(message) ||
    (hasDesignMedia ? 'Imagen enviada por el cliente' : '');

  if (!normalizedMessage) {
    const error = new Error('message es obligatorio');
    error.code = 'MESSAGE_REQUIRED';
    throw error;
  }

  const normalizedInstructions = normalizeMessage(instructions);
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
      metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        instructions: normalizedInstructions || null
      }
    },
    async context => {
      resolvedContext = context;
      const ownerMode = Boolean(context.owner?.isOwner);

      const ownerCommand = ownerMode
        ? detectOwnerCommand(normalizedMessage)
        : null;

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

      if (ownerMode) {
        const crmConversation = await processCrmConversation({
          message: normalizedMessage,
          externalUserId: context.externalUserId || externalUserId || null,
          phone: context.phone || phone || null
        });

        if (crmConversation.handled) {
          return {
            outputText: crmConversation.outputText,
            model: 'elankav-crm-conversation',
            id: null,
            status: crmConversation.completed ? 'completed' : 'in_progress',
            usage: null,
            crmAction: true
          };
        }
      }

      let aiRuntime = null;

      if (!ownerMode) {
        const runtimeState = await loadConnectAiRuntimeSafely({
          platform: context.platform || platform || 'ELANVISUAL'
        });

        if (!runtimeState.available || !runtimeState.runtime) {
          console.error('[CONNECT_AI_RUNTIME_FAIL_CLOSED]', {
            platform: context.platform || platform || null,
            reason: runtimeState.error || 'CONNECT_AI_RUNTIME_UNAVAILABLE'
          });
          return {
            outputText: '',
            model: 'elankav-connect-runtime-gate',
            id: null,
            status: 'suppressed',
            usage: null,
            suppressed: true,
            suppressReason: 'CONNECT_AI_RUNTIME_UNAVAILABLE',
            aiRuntime: null
          };
        }

        aiRuntime = runtimeState.runtime;

        if (aiRuntime.execution?.shouldRespond !== true) {
          console.info('[CONNECT_AI_RUNTIME_RESPONSES_OFF]', {
            platform: aiRuntime.platform?.platformId || context.platform || platform || null,
            version: aiRuntime.version || null
          });
          return {
            outputText: '',
            model: 'elankav-connect-runtime-gate',
            id: null,
            status: 'suppressed',
            usage: null,
            suppressed: true,
            suppressReason: 'CONNECT_PLATFORM_RESPONSES_DISABLED',
            aiRuntime
          };
        }
      }

      if (!ownerMode) {
        const designFollowup = await processDesignFollowup({
          message: normalizedMessage,
          phone: context.phone || phone || null,
          externalUserId: context.externalUserId || externalUserId || null
        });

        if (designFollowup.handled) {
          return {
            outputText: designFollowup.outputText,
            model: 'elankav-design-followup',
            id: null,
            status: designFollowup.completed ? 'completed' : 'in_progress',
            usage: null,
            designAction: true
          };
        }
      }

      const designConversation =
        await handleDesignIntent({
          message: normalizedMessage,
          context,
          platform,
          channel,
          externalUserId,
          phone,
          metadata,
          aiRuntime
        });

      if (designConversation.handled) {
        return designConversation;
      }

      let crm = null;
      let ecosystem = null;
      let commercial = null;
      let commercialState = context.commercial?.state || null;

      if (ownerMode) {
        [crm, ecosystem] = await Promise.all([
          loadCrmContext(),
          loadEcosystemContext()
        ]);
      } else if (runtimeCatalogEnabled(aiRuntime)) {
        const runtimeHistory = resolveRuntimeHistory(aiRuntime, metadata?.conversationHistory);
        commercial = await loadCommercialContext({
          message: normalizedMessage,
          history: runtimeHistory,
          platform: context.platform || platform || 'ELANVISUAL',
          commercialState
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

      const runtimeHistory = ownerMode
        ? []
        : resolveRuntimeHistory(aiRuntime, metadata?.conversationHistory);

      const generatedResponse = await generateText({
        input: normalizedMessage,
        history: runtimeHistory,
        instructions: resolveMessageInstructions({
          ownerMode,
          customInstructions: normalizedInstructions,
          runtime: aiRuntime
        }),
        context: {
          ownerMode,
          ownerName: ownerMode ? 'Erick Cano' : null,
          externalUserId: context.externalUserId || externalUserId || null,
          phone: context.phone || phone || null,
          platform: context.platform || platform || null,
          channel: context.channel || channel || null,
          crm,
          ecosystem,
          commercial,
          commercialState,
          aiRuntime
        }
      });

      const commercialResponse = applyVerifiedCommercialReply({
        message: normalizedMessage,
        history: runtimeHistory,
        commercialState,
        commercial,
        response: generatedResponse
      });

      if (!ownerMode) {
        const elapsedMs = Date.now() - startedAt;
        console.info('[COMMERCIAL_TRACE]', {
          requestId: context.requestId || metadata?.requestId || null,
          elapsedMs,
          platform: commercialState?.platform || context.platform || null,
          product: commercialState?.product || commercial?.productName || null,
          category: commercialState?.category || null,
          sku: commercialState?.sku || commercial?.productId || null,
          matchedAlias: commercial?.matchedAlias || null,
          intent: commercialState?.intent || null,
          documentUsed: commercialState?.documentUsed || null,
          priceSource: commercial?.priceSource?.status || commercialState?.priceSource || null,
          sourceDocument: commercial?.priceSource?.source || commercialState?.documentUsed || null,
          approved: commercial?.priceSource?.approved === true,
          fallbackUsed: commercial?.fallbackUsed === true,
          priceFound: commercialState?.verifiedPrice || null,
          formula: commercialState?.formula || null,
          formulaType: commercialState?.formulaType || null,
          calculatedPrice: commercialState?.calculatedPrice || null,
          calculationBreakdown: commercialState?.calculationBreakdown || null,
          conversationStatus: commercialState?.conversationStatus || null
        });
      }

      return commercialResponse;
    }
  );

  return {
    message: normalizedMessage,
    reply: String(response.outputText || '').trim(),
    provider:
      response.ownerCommand ||
      response.crmAction ||
      response.designAction ||
      response.commercialAction ||
      response.suppressed
        ? 'elankav'
        : 'openai',
    model: response.model,
    responseId: response.id,
    status: response.status,
    usage: response.usage,
    design: response.design || null,
    command: response.ownerCommand || null,
    jobId: response.jobId || null,
    suppressed: response.suppressed === true,
    suppressReason: response.suppressReason || null,
    context: {
      version: resolvedContext?.version || null,
      platform: resolvedContext?.platform || null,
      channel: resolvedContext?.channel || null,
      externalUserId: resolvedContext?.externalUserId || null,
      ownerMode: Boolean(resolvedContext?.owner?.isOwner),
      aiRuntimeAuthority: response.aiRuntime?.authority || null,
      aiRuntimeVersion: response.aiRuntime?.version || null,
      commercialState: response.commercialState ||
        resolvedContext?.commercial?.state ||
        null
    },
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  OWNER_INSTRUCTIONS,
  buildDesignPortalLink,
  buildDesignPortalText,
  buildRuntimeInstructions,
  normalizeMessage,
  resolveMessageInstructions,
  resolveRuntimeHistory,
  runtimeCatalogEnabled,
  handleDesignIntent,
  processMessage
};
