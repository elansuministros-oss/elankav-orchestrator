'use strict';

const businessCommands = require('./ownerBusinessCommandService');
const sellerRegistration = require('./ownerSellerRegistrationService');
const {
  addItemByHumanReference,
  parseAddQuotationItemRequest
} = require('./ownerQuotationMediaService');

const QUOTATION_ITEM_ADD = 'business_quotation_item_add';

const originalDetectOwnerBusinessCommand = businessCommands.detectOwnerBusinessCommand;
const originalExecuteOwnerBusinessCommand = businessCommands.executeOwnerBusinessCommand;
const originalProcessSellerRegistrationConversation = sellerRegistration.processSellerRegistrationConversation;

function detectOwnerBusinessCommand(message) {
  const request = parseAddQuotationItemRequest(message);
  if (request) {
    return {
      type: QUOTATION_ITEM_ADD,
      input: request
    };
  }

  return originalDetectOwnerBusinessCommand(message);
}

async function executeOwnerBusinessCommand(command) {
  if (command?.type === QUOTATION_ITEM_ADD) {
    return addItemByHumanReference(command.input || {});
  }

  return originalExecuteOwnerBusinessCommand(command);
}

async function processSellerRegistrationConversation(args = {}) {
  const request = parseAddQuotationItemRequest(args.message);
  if (request) {
    try {
      const result = await addItemByHumanReference(request);
      return {
        handled: true,
        completed: result?.status === 'completed',
        outputText: result?.outputText || 'No fue posible completar la actualización de la cotización.'
      };
    } catch (error) {
      return {
        handled: true,
        completed: true,
        outputText: [
          'No pude agregar el nuevo ítem a la cotización.',
          `Error: ${error?.code || 'QUOTATION_ITEM_ADD_FAILED'}`,
          error?.message ? `Detalle: ${error.message}` : '',
          'No se creó ninguna cotización nueva.'
        ].filter(Boolean).join('\n')
      };
    }
  }

  return originalProcessSellerRegistrationConversation(args);
}

businessCommands.detectOwnerBusinessCommand = detectOwnerBusinessCommand;
businessCommands.executeOwnerBusinessCommand = executeOwnerBusinessCommand;
businessCommands.BUSINESS_COMMANDS = Object.freeze({
  ...(businessCommands.BUSINESS_COMMANDS || {}),
  QUOTATION_ITEM_ADD
});

sellerRegistration.processSellerRegistrationConversation = processSellerRegistrationConversation;

module.exports = {
  QUOTATION_ITEM_ADD,
  detectOwnerBusinessCommand,
  executeOwnerBusinessCommand,
  processSellerRegistrationConversation
};
