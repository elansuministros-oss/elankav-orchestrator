'use strict';

const businessCommands = require('./ownerBusinessCommandService');
const {
  addItemByHumanReference,
  parseAddQuotationItemRequest
} = require('./ownerQuotationMediaService');

const QUOTATION_ITEM_ADD = 'business_quotation_item_add';

const originalDetectOwnerBusinessCommand = businessCommands.detectOwnerBusinessCommand;
const originalExecuteOwnerBusinessCommand = businessCommands.executeOwnerBusinessCommand;

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

businessCommands.detectOwnerBusinessCommand = detectOwnerBusinessCommand;
businessCommands.executeOwnerBusinessCommand = executeOwnerBusinessCommand;
businessCommands.BUSINESS_COMMANDS = Object.freeze({
  ...(businessCommands.BUSINESS_COMMANDS || {}),
  QUOTATION_ITEM_ADD
});

module.exports = {
  QUOTATION_ITEM_ADD,
  detectOwnerBusinessCommand,
  executeOwnerBusinessCommand
};
