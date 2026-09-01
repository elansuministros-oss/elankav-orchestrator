'use strict';

const commandService = require('./elanUnifiedOwnerCommandService');
const previousDetect = commandService.detectOwnerUnifiedCommand;

function cleanPreviewName(value) {
  return String(value || '').trim().replace(/^[\s:;=\-]+/, '').trim();
}

commandService.detectOwnerUnifiedCommand = function detectWithSanitizedSellerPreview(message) {
  const command = previousDetect(message);
  if (command?.sellerPreview && command.data && typeof command.data === 'object' && command.data.displayName) {
    command.data = { ...command.data, displayName: cleanPreviewName(command.data.displayName) };
  }
  return command;
};

module.exports = { cleanPreviewName };
