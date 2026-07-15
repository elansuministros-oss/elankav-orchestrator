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
  loadCommercialContext
} = require('./commercialContextService');
const {
  buildDesignConversationPrompt,
  detectConversationDesignIntent,
  shouldRequestLogo
} = require('./designIntentService');
const {
  processDesignRequest
} = require('./designEngineService');

const DESIGN_PORTAL_URL = 'https://visual.elankav.com/diseno/whatsapp';

const CUSTOMER_INSTRUCTIONS = [
  'Sos ELAN IA, asistente comercial de atención al cliente del ecosistema ELANKAV.',
  'Respondé en español natural, amable, breve y profesional.',
  'Atendé primero la solicitud concreta del cliente y no conviertas una explicación en un formulario.',
  'Hacé como máximo una pregunta por respuesta y solo cuando sea indispensable para avanzar.',
  'No repitas datos que el cliente ya proporcionó.',
  'No exijas nombre, logotipo, fotografía ni archivo para brindar una orientación o precio autorizado.',
  'Si el cliente ya indicó producto, medida y si es interior o exterior, no hagas preguntas adicionales innecesarias.',
  'Si pregunta por precio, respondé con el precio únicamente cuando esté presente en el contexto verificado; nunca inventes precios.',
  'Cuando falte un precio verificado, indicá que debe revisarse en el cotizador y continuá ayudando con la información disponible.',
  'Cuando exista contexto comercial verificado, usá el nombre, las medidas, el precio y la modalidad exactos de ese contexto.',
  'Usá únicamente sitios web y ubicaciones presentes en el contexto oficial verificado; nunca inventes, completes ni adivines dominios o ubicaciones.',
  'No presentes la página principal como catálogo. Solo afirmes que existe un catálogo cuando el contexto incluya un enlace exacto y verificado al catálogo solicitado.',
  'Si no existe un enlace exacto al catálogo, indicá que podés orientar con muestras verificadas sin inventar enlaces.',
  'Decí “desde” únicamente cuando la oferta verificada sea starting-at y aclará que el precio es aproximado cuando así se indique.',
  'Después de orientar el precio, hacé una sola pregunta útil para acercar al cliente a la cotización o al cierre.',
  'No hables de Orchestrator, repositorios, herramientas internas, permisos técnicos ni programación con clientes.',
  'No trates al cliente como proveedor ni inicies flujos CRM internos por una explicación general.',
  'No prometas fabricación, instalación, entrega o disponibilidad sin datos confirmados.',
  'Respondé únicamente al mensaje recibido y mantené el contexto de la plataforma indicada.'
].join(' ');

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

function resolveMessageInstructions({
  ownerMode,
  customInstructions
}) {
  const normalizedCustom = normalizeMessage(customInstructions);

  if (normalizedCustom) {
    return normalizedCustom;
  }

  return ownerMode
    ? OWNER_INSTRUCTIONS
    : CUSTOMER_INSTRUCTIONS;
}

function buildDesignPortalLink() {
  return DESIGN_PORTAL_URL;
}

async function handleDesignIntent({
  message,
  context = {},
  platform,
  channel,
  externalUserId,
  phone,
  metadata
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
  const usePortal =
    String(resolvedChannel || '').toLowerCase() === 'whatsapp' &&
    metadata?.designPortalBypass !== true;

  if (usePortal) {
    const link = buildDesignPortalLink({
      message,
      history,
      phone: context.phone || phone || null,
      externalUserId: context.externalUserId || externalUserId || null,
      conversationRef: metadata?.conversationRef || metadata?.requestId || null
    });

    return {
      outputText: `Completá tu solicitud de diseño en el sitio oficial de ELANVISUAL:\n${link}\n\nAl enviarla recibirás un código de seguimiento.`,
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
        instructions: normalizedInstructions || CUSTOMER_INSTRUCTIONS
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

      const designConversation =
        await handleDesignIntent({
          message: normalizedMessage,
          context,
          platform,
          channel,
          externalUserId,
          phone,
          metadata
        });

      if (designConversation.handled) {
        return designConversation;
      }

      let crm = null;
      let ecosystem = null;
      let commercial = null;

      if (ownerMode) {
        [crm, ecosystem] = await Promise.all([
          loadCrmContext(),
          loadEcosystemContext()
        ]);
      } else {
        commercial = await loadCommercialContext({
          message: normalizedMessage,
          history: metadata?.conversationHistory
        });
      }

      return generateText({
        input: normalizedMessage,
        history: ownerMode
          ? []
          : metadata?.conversationHistory,
        instructions: resolveMessageInstructions({
          ownerMode,
          customInstructions: normalizedInstructions
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
          commercial
        }
      });
    }
  );

  return {
    message: normalizedMessage,
    reply: response.outputText.trim(),
    provider:
      response.ownerCommand ||
      response.crmAction ||
      response.designAction
        ? 'elankav'
        : 'openai',
    model: response.model,
    responseId: response.id,
    status: response.status,
    usage: response.usage,
    design: response.design || null,
    command: response.ownerCommand || null,
    jobId: response.jobId || null,
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
  CUSTOMER_INSTRUCTIONS,
  OWNER_INSTRUCTIONS,
  buildDesignPortalLink,
  normalizeMessage,
  resolveMessageInstructions,
  handleDesignIntent,
  processMessage
};
