'use strict';

const commandService = require('./elanUnifiedOwnerCommandService');
const { detectSellerFieldUpdate, normalizeHumanMessage } = require('./humanLanguageInterpreter');

const previousDetect = commandService.detectOwnerUnifiedCommand;

commandService.detectOwnerUnifiedCommand = function detectOwnerHumanLanguageIntent(message) {
  const normalized = normalizeHumanMessage(message);
  const sellerFieldUpdate = detectSellerFieldUpdate(normalized);
  if (sellerFieldUpdate) return sellerFieldUpdate;
  return previousDetect(normalized);
};

module.exports = {
  detectSellerFieldUpdate,
  normalizeHumanMessage
};
