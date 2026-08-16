'use strict';

const { buildContext } = require('./context/contextBuilder');
const businessCommands = require('./ownerBusinessCommandService');
const {
  addItemByHumanReference
} = require('./ownerQuotationHomonymResolver');
const {
  parseAddQuotationItemRequest
} = require('./ownerQuotationHumanReferenceParser');

const QUOTATION_ITEM_ADD = 'business_quotation_item_add';
const INSTALL_MARK = Symbol.for('elankav.ownerBusinessProcessMessageGateway.installed');

function detectOwnerBusinessCommand(message) {
  const quotationItemRequest = parseAddQuotationItemRequest(message);
  if (quotationItemRequest) {
    return {
      type: QUOTATION_ITEM_ADD,
      input: quotationItemRequest
    };
  }

  return businessCommands.detectOwnerBusinessCommand(message);
}

async function executeOwnerBusinessCommand(command) {
  if (command?.type === QUOTATION_ITEM_ADD) {
    const result = await addItemByHumanReference(command.input || {});
    return {
      handled: true,
      outputText: result?.outputText || 'Cotización actualizada.',
      result
    };
  }

  return businessCommands.executeOwnerBusinessCommand(command);
}

function buildOwnerContext(args, buildContextImpl = buildContext) {
  return buildContextImpl({
    message: args?.message,
    source: 'messageService-owner-business-gateway',
    platform: args?.platform,
    channel: args?.channel,
    externalUserId: args?.externalUserId,
    phone: args?.phone,
    metadata: args?.metadata && typeof args.metadata === 'object' ? args.metadata : {}
  });
}

function transactionalFailure({ args, context, command, error }) {
  const errorCode = error?.code || 'OWNER_BUSINESS_COMMAND_FAILED';
  const detail = error?.message || 'No fue posible completar la operación empresarial.';

  console.error('[OWNER_BUSINESS_RESULT]', {
    handler: command?.type || null,
    status: 'failed',
    errorCode,
    platform: context?.platform || args?.platform || 'elanvisual'
  });

  return {
    message: String(args?.message || '').trim(),
    reply: [
      'No pude completar la operación empresarial solicitada.',
      `Error: ${errorCode}`,
      detail,
      'No ejecuté una respuesta generativa ni creé una cotización nueva como alternativa.'
    ].join('\n'),
    provider: 'elankav',
    model: 'elankav-owner-business-command',
    responseId: null,
    status: 'failed',
    usage: null,
    suppressDelivery: false,
    command: command?.type || null,
    jobId: null,
    ownerCommercialQuery: true,
    ownerCrmCommand: false,
    ownerBusinessCommand: true,
    actorRole: 'owner',
    actorId: null,
    accessScopes: null,
    runtimeVersion: null,
    knowledgeAvailable: null,
    historyMessages: null,
    context: {
      version: context?.version || null,
      platform: context?.platform || null,
      channel: context?.channel || null,
      externalUserId: context?.externalUserId || null,
      ownerMode: Boolean(context?.owner?.isOwner)
    }
  };
}

function transactionalSuccess({ args, context, command, execution }) {
  const resultStatus = execution?.result?.status;
  const status = resultStatus === 'in_progress' ? 'in_progress' : 'completed';

  console.log('[OWNER_BUSINESS_RESULT]', {
    handler: command?.type || null,
    status,
    platform: context?.platform || args?.platform || 'elanvisual'
  });

  return {
    message: String(args?.message || '').trim(),
    reply: String(execution?.outputText || '').trim(),
    provider: 'elankav',
    model: 'elankav-owner-business-command',
    responseId: null,
    status,
    usage: null,
    suppressDelivery: false,
    command: command?.type || null,
    jobId: null,
    ownerCommercialQuery: true,
    ownerCrmCommand: false,
    ownerBusinessCommand: true,
    actorRole: 'owner',
    actorId: null,
    accessScopes: null,
    runtimeVersion: null,
    knowledgeAvailable: null,
    historyMessages: null,
    context: {
      version: context?.version || null,
      platform: context?.platform || null,
      channel: context?.channel || null,
      externalUserId: context?.externalUserId || null,
      ownerMode: Boolean(context?.owner?.isOwner)
    }
  };
}

function createOwnerBusinessProcessMessage({
  originalProcessMessage,
  buildContextImpl = buildContext,
  detectCommandImpl = detectOwnerBusinessCommand,
  executeCommandImpl = executeOwnerBusinessCommand
} = {}) {
  if (typeof originalProcessMessage !== 'function') {
    throw new TypeError('originalProcessMessage es obligatorio');
  }

  return async function processMessageWithOwnerBusinessGateway(args = {}) {
    const context = buildOwnerContext(args, buildContextImpl);

    if (!context?.owner?.isOwner) {
      return originalProcessMessage(args);
    }

    const command = detectCommandImpl(args.message);
    if (!command) {
      return originalProcessMessage(args);
    }

    console.log('[OWNER_ROUTE_SELECTED]', {
      handler: command.type,
      platform: context.platform || args.platform || 'elanvisual',
      ownerMode: true
    });

    console.log('[OWNER_BUSINESS_EXECUTE]', {
      handler: command.type,
      platform: context.platform || args.platform || 'elanvisual'
    });

    try {
      const execution = await executeCommandImpl(command);

      if (!execution?.handled) {
        const error = new Error(`Handler empresarial ${command.type} fue detectado pero no ejecutado.`);
        error.code = 'OWNER_BUSINESS_HANDLER_NOT_EXECUTED';
        return transactionalFailure({ args, context, command, error });
      }

      return transactionalSuccess({ args, context, command, execution });
    } catch (error) {
      return transactionalFailure({ args, context, command, error });
    }
  };
}

function installOwnerBusinessProcessMessageGateway(messageService = require('./messageService')) {
  if (!messageService || typeof messageService.processMessage !== 'function') {
    throw new TypeError('messageService.processMessage no está disponible');
  }

  if (messageService[INSTALL_MARK]) {
    return messageService.processMessage;
  }

  const originalProcessMessage = messageService.processMessage;
  const wrappedProcessMessage = createOwnerBusinessProcessMessage({ originalProcessMessage });

  Object.defineProperty(messageService, INSTALL_MARK, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });

  messageService.processMessage = wrappedProcessMessage;

  console.log('[OWNER_BUSINESS_GATEWAY_INSTALLED]', {
    boundary: 'processMessage',
    quotationItemAdd: true
  });

  return wrappedProcessMessage;
}

module.exports = {
  QUOTATION_ITEM_ADD,
  createOwnerBusinessProcessMessage,
  detectOwnerBusinessCommand,
  executeOwnerBusinessCommand,
  installOwnerBusinessProcessMessageGateway
};
