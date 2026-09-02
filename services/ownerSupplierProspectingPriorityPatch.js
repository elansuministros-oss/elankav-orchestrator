'use strict';

const { buildContext } = require('./context/contextBuilder');
const {
  detectOwnerProspectingCommand,
  executeOwnerProspectingCommand,
  isSupplierProspectingMission
} = require('./ownerProspectingCommandService');

const INSTALL_MARK = Symbol.for('elankav.ownerSupplierProspectingPriorityPatch.installed');

function buildOwnerContext(args = {}) {
  return buildContext({
    message: args.message,
    source: 'owner-supplier-prospecting-priority',
    platform: args.platform,
    channel: args.channel,
    externalUserId: args.externalUserId,
    phone: args.phone,
    metadata: args.metadata && typeof args.metadata === 'object' ? args.metadata : {}
  });
}

function supplierCommand(message) {
  const command = detectOwnerProspectingCommand(message);
  if (!command) return null;
  if (!isSupplierProspectingMission(command.input && command.input.mission)) return null;
  return command;
}

function successResult(args, context, command, execution) {
  return {
    message: String(args.message || '').trim(),
    reply: String(execution.outputText || '').trim(),
    provider: 'elankav',
    model: 'elankav-owner-supplier-prospecting-priority',
    responseId: null,
    status: 'completed',
    usage: null,
    suppressDelivery: false,
    command: command.type,
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
      version: context && context.version || null,
      platform: context && context.platform || null,
      channel: context && context.channel || null,
      externalUserId: context && context.externalUserId || null,
      ownerMode: true
    }
  };
}

function failureResult(args, context, command, error) {
  return {
    message: String(args.message || '').trim(),
    reply: [
      'No pude iniciar la búsqueda masiva de proveedores.',
      `Error: ${error && error.code || 'SUPPLIER_PROSPECTING_FAILED'}`,
      String(error && error.message || 'Falló la operación de Prospecting.'),
      'No contacté proveedores ni modifiqué la base oficial.'
    ].join('\n'),
    provider: 'elankav',
    model: 'elankav-owner-supplier-prospecting-priority',
    responseId: null,
    status: 'failed',
    usage: null,
    suppressDelivery: false,
    command: command && command.type || null,
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
      version: context && context.version || null,
      platform: context && context.platform || null,
      channel: context && context.channel || null,
      externalUserId: context && context.externalUserId || null,
      ownerMode: true
    }
  };
}

function installOwnerSupplierProspectingPriorityPatch(messageService = require('./messageService')) {
  if (!messageService || typeof messageService.processMessage !== 'function') {
    throw new TypeError('messageService.processMessage no está disponible');
  }
  if (messageService[INSTALL_MARK]) return messageService.processMessage;

  const originalProcessMessage = messageService.processMessage;
  messageService.processMessage = async function processMessageWithSupplierPriority(args = {}) {
    const context = buildOwnerContext(args);
    if (!context || !context.owner || context.owner.isOwner !== true) {
      return originalProcessMessage(args);
    }

    const command = supplierCommand(args.message);
    if (!command) return originalProcessMessage(args);

    console.log('[OWNER_SUPPLIER_PROSPECTING_PRIORITY]', {
      handler: command.type,
      targetCompanies: Number(command.input && command.input.targetCompanies || 0),
      platform: context.platform || args.platform || 'elanvisual'
    });

    try {
      const execution = await executeOwnerProspectingCommand(command);
      if (!execution || execution.handled !== true) {
        const error = new Error('El handler de búsqueda masiva de proveedores no ejecutó la operación.');
        error.code = 'SUPPLIER_PROSPECTING_HANDLER_NOT_EXECUTED';
        return failureResult(args, context, command, error);
      }
      return successResult(args, context, command, execution);
    } catch (error) {
      return failureResult(args, context, command, error);
    }
  };

  Object.defineProperty(messageService, INSTALL_MARK, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return messageService.processMessage;
}

module.exports = {
  buildOwnerContext,
  installOwnerSupplierProspectingPriorityPatch,
  supplierCommand
};
