'use strict';

require('./ownerOpsSupervisorCommandPatch');

const gateway = require('./ownerBusinessProcessMessageGateway');
const {
  installOwnerSupplierProspectingPriorityPatch
} = require('./ownerSupplierProspectingPriorityPatch');
const {
  installOwnerSupplierMissionStatusPatch
} = require('./ownerSupplierMissionStatusPatch');

// Compatibilidad controlada:
// este archivo sigue siendo el preload usado por npm/systemd bootstrap.
// Instala primero el gateway empresarial general y después las prioridades
// explícitas de Prospecting para el Owner.
gateway.installOwnerBusinessProcessMessageGateway();
installOwnerSupplierProspectingPriorityPatch();
installOwnerSupplierMissionStatusPatch();

module.exports = {
  QUOTATION_ITEM_ADD: gateway.QUOTATION_ITEM_ADD,
  createOwnerBusinessProcessMessage: gateway.createOwnerBusinessProcessMessage,
  detectOwnerBusinessCommand: gateway.detectOwnerBusinessCommand,
  executeOwnerBusinessCommand: gateway.executeOwnerBusinessCommand,
  installOwnerBusinessProcessMessageGateway: gateway.installOwnerBusinessProcessMessageGateway,
  installOwnerSupplierProspectingPriorityPatch,
  installOwnerSupplierMissionStatusPatch
};
