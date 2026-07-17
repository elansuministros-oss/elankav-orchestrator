const { createWorkOrderContract } = require('../contract');

function mapQuotationToWorkOrderContract(_quotationDocument = {}) {
  const error = new Error('WorkOrderMapper preparado para quotation, no activado en WO-01');
  error.code = 'WORK_ORDER_QUOTATION_MAPPING_NOT_ACTIVE';
  throw error;
}

module.exports = {
  WorkOrderMapper: Object.freeze({
    fromQuotation: mapQuotationToWorkOrderContract,
    createManual: createWorkOrderContract
  })
};
