'use strict';

const commandService = require('./elanUnifiedOwnerCommandService');
const {
  detectSellerAccessDelivery,
  detectSellerFieldUpdate,
  normalizeHumanMessage
} = require('./humanLanguageInterpreter');

const previousDetect = commandService.detectOwnerUnifiedCommand;

commandService.detectOwnerUnifiedCommand = function detectOwnerHumanLanguageIntent(message) {
  const normalized = normalizeHumanMessage(message);
  const sellerAccessDelivery = detectSellerAccessDelivery(normalized);
  if (sellerAccessDelivery) return sellerAccessDelivery;
  const sellerFieldUpdate = detectSellerFieldUpdate(normalized);
  if (sellerFieldUpdate) return sellerFieldUpdate;
  return previousDetect(normalized);
};

module.exports = {
  detectSellerAccessDelivery,
  detectSellerFieldUpdate,
  normalizeHumanMessage
};
