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
        return {
          outputText: '',
          model: 'elankav-customer-auto-reply-disabled',
          id: null,
          status: 'automation_disabled',
          usage: null,
          suppressDelivery: true
        };
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
  processMessage
};
