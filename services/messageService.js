'use strict';

const { generateText } = require('./openaiService');
const { routeContext } = require('./context/index');
const { detectOwnerCommand, executeOwnerCommand } = require('./ownerCommandService');
const { loadCrmContext } = require('./crmContextService');
const { processCrmConversation } = require('./crmConversationService');
const { loadEcosystemContext } = require('./ecosystemContextService');
const { loadPublishedRuntime, loadOfficialCatalogContext } = require('./aiRuntimeClient');
const { getHistory, appendTurn } = require('./aiConversationContinuityService');

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

function disabledResponse(status, model, runtimeVersion = null) {
  return {
    outputText: '',
    model,
    id: null,
    status,
    usage: null,
    suppressDelivery: true,
    runtimeVersion
  };
}

async function processCustomerMessage({ normalizedMessage, context, platform, channel, externalUserId, phone }) {
  let runtime;
  try {
    runtime = await loadPublishedRuntime(context.platform || platform || '');
  } catch (error) {
    return disabledResponse('runtime_unavailable', 'elankav-connect-runtime-unavailable');
  }

  if (!runtime.execution?.shouldRespond) {
    return disabledResponse('automation_disabled', 'elankav-connect-runtime-disabled', runtime.version);
  }

  const platformConfig = runtime.platform || {};
  const identity = {
    platform: platformConfig.platformId || context.platform || platform,
    externalUserId: context.externalUserId || externalUserId || null,
    phone: context.phone || phone || null
  };
  const history = getHistory(identity, platformConfig.continuity);

  let catalog = null;
  if (platformConfig.catalogAccess?.enabled !== false) {
    try {
      catalog = await loadOfficialCatalogContext(identity.platform, normalizedMessage);
    } catch (error) {
      return disabledResponse('catalog_unavailable', 'elankav-official-catalog-unavailable', runtime.version);
    }
  }

  const instructions = [
    platformConfig.instructions,
    platformConfig.initialMessage ? `Mensaje inicial autorizado: ${platformConfig.initialMessage}` : '',
    `Reglas publicadas: ${JSON.stringify(platformConfig.responseRules || {})}`,
    'Usá exclusivamente la configuración publicada desde CONNECT. No inventés información y no mezcles plataformas.'
  ].filter(Boolean).join('\n\n');

  const generated = await generateText({
    input: normalizedMessage,
    history,
    instructions,
    context: {
      ownerMode: false,
      externalUserId: identity.externalUserId,
      phone: identity.phone,
      platform: identity.platform,
      channel: context.channel || channel || null,
      publishedRuntimeVersion: runtime.version,
      officialCatalog: catalog
    }
  });

  const outputText = String(generated.outputText || '').trim();
  if (!outputText) return disabledResponse('empty_response', generated.model || 'openai', runtime.version);
  appendTurn(identity, platformConfig.continuity, normalizedMessage, outputText);
  return { ...generated, outputText, status: generated.status || 'completed', suppressDelivery: false, runtimeVersion: runtime.version };
}

async function processMessage({ message, platform, channel, externalUserId, phone, metadata }) {
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
        return processCustomerMessage({ normalizedMessage, context, platform, channel, externalUserId, phone });
      }

      const ownerCommand = detectOwnerCommand(normalizedMessage);
      if (ownerCommand) {
        const commandResult = await executeOwnerCommand({ command: ownerCommand, platform: context.platform || platform || 'elankav' });
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

      const [crm, ecosystem] = await Promise.all([loadCrmContext(), loadEcosystemContext()]);
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
    runtimeVersion: response.runtimeVersion || null,
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

module.exports = { OWNER_INSTRUCTIONS, normalizeMessage, processMessage, processCustomerMessage };
