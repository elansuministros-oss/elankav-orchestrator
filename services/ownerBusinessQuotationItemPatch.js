'use strict';

const gateway = require('./ownerBusinessProcessMessageGateway');

// Compatibilidad controlada:
// este archivo sigue siendo el preload usado por npm/systemd bootstrap,
// pero ya no modifica ownerSellerRegistrationService ni captura handlers internos.
// Su única responsabilidad es instalar el gateway en el límite público de processMessage.
gateway.installOwnerBusinessProcessMessageGateway();

module.exports = {
  QUOTATION_ITEM_ADD: gateway.QUOTATION_ITEM_ADD,
  createOwnerBusinessProcessMessage: gateway.createOwnerBusinessProcessMessage,
  detectOwnerBusinessCommand: gateway.detectOwnerBusinessCommand,
  executeOwnerBusinessCommand: gateway.executeOwnerBusinessCommand,
  installOwnerBusinessProcessMessageGateway: gateway.installOwnerBusinessProcessMessageGateway
};
