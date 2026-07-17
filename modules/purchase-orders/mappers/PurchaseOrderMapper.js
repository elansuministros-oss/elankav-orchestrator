const { createPurchaseOrderContract } = require('../contract');

function mapWorkOrderToPurchaseOrderContract(_workOrder = {}) {
  const error = new Error('PurchaseOrderMapper preparado para workOrder, no activado en PO-01');
  error.code = 'PURCHASE_ORDER_WORK_ORDER_MAPPING_NOT_ACTIVE';
  throw error;
}

module.exports = {
  PurchaseOrderMapper: Object.freeze({
    fromWorkOrder: mapWorkOrderToPurchaseOrderContract,
    createManual: createPurchaseOrderContract
  })
};
