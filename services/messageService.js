'use strict';

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
  buildCustomerInstructions,
  getPublishedRuntime
} = require('./connectAiRuntimeService');
const {
  loadPlatformKnowledgeSafely
} = require('./connectPlatformKnowledgeService');

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

async function processCustomerMessage({ normalizedMessage, context, platform, channel, externalUserId, phone }) {
  const runtime = await getPublishedRuntime(context.platform || platform || 'elanvisual');
  if (!runtime.shouldRespond) {
    return {
      outputText: '',
      model: 'elankav-connect-runtime-disabled',
      id: null,
      status: 'automation_disabled',
      usage: null,
      suppressDelivery: true,
      runtimeVersion: runtime.version || null
    };
  }

  const knowledge = await loadPlatformKnowledgeSafely({
    platform: runtime.platformId,
    query: normalizedMessage
  });

  const generated = await generateText({
    input: normalizedMessage,
    history: [],
    instructions: buildCustomerInstructions(runtime),
    context: {
      ownerMode: false,
      customerMode: true,
      externalUserId: context.externalUserId || externalUserId || null,
      phone: context.phone || phone || null,
      platform: runtime.platformId,
      channel: context.channel || channel || null,
      runtime: {
        schemaVersion: runtime.schemaVersion || null,
        version: runtime.version || null,
        publishedAt: runtime.publishedAt || null,
        initialMessage: runtime.platform?.initialMessage || ''
      },
      officialKnowledge: knowledge
    }
  });

  return {
    ...generated,
    status: generated.status || 'completed',
    runtimeVersion: runtime.version || null,
    knowledgeAvailable: Boolean(knowledge?.available)
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
        return processCustomerMessage({
          normalizedMessage,
          context,
          platform,
          channel,
          externalUserId,
          phone
        });
      }

      const ownerCommand = detectOwnerCommand(normalizedMessage);
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
        return {
          outputText: crmConversation.outputText,
          model: 'elankav-crm-conversation',
          id: null,
          status: crmConversation.completed ? 'completed' : 'in_progress',
          usage: null,
          crmAction: true
        };
      }

      const [crm, ecosystem] = await Promise.all([
        loadCrmContext(),
        loadEcosystemContext()
      ]);

      return generateText({
        input: normalizedMessage,
        history: [],
        instructions: OWNER_INSTRUCTIONS,
        context: {
          ownerMode: true,
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
    runtimeVersion: response.runtimeVersion || null,
    knowledgeAvailable: response.knowledgeAvailable ?? null,
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
  processCustomerMessage,
  processMessage
};
