'use strict';

const gateway = require('./ownerBusinessProcessMessageGateway');
const {
  installOwnerSupplierProspectingPriorityPatch
} = require('./ownerSupplierProspectingPriorityPatch');

// Compatibilidad controlada:
// este archivo sigue siendo el preload usado por npm/systemd bootstrap.
// Instala primero el gateway empresarial general y después la prioridad
// explícita para misiones masivas de proveedores del Owner.
gateway.installOwnerBusinessProcessMessageGateway();
installOwnerSupplierProspectingPriorityPatch();

module.exports = {
  QUOTATION_ITEM_ADD: gateway.QUOTATION_ITEM_ADD,
  createOwnerBusinessProcessMessage: gateway.createOwnerBusinessProcessMessage,
  detectOwnerBusinessCommand: gateway.detectOwnerBusinessCommand,
  executeOwnerBusinessCommand: gateway.executeOwnerBusinessCommand,
  installOwnerBusinessProcessMessageGateway: gateway.installOwnerBusinessProcessMessageGateway,
  installOwnerSupplierProspectingPriorityPatch
};
