const { getPlatformBrand } = require('../../../adapters/vqs/brandRegistryAdapter');

class WorkOrderDocumentBuilder {
  build({ workOrder } = {}) {
    if (!workOrder?.platformId) {
      const error = new Error('workOrder.platformId es obligatorio');
      error.code = 'WORK_ORDER_DOCUMENT_INPUT_INVALID';
      throw error;
    }

    const brand = getPlatformBrand(workOrder.platformId);
    if (!brand) {
      const error = new Error(`Plataforma no registrada: ${workOrder.platformId}`);
      error.code = 'WORK_ORDER_PLATFORM_NOT_FOUND';
      throw error;
    }

    return {
      schemaVersion: '1.0.0',
      documentType: 'work_order',
      platformId: brand.platformId,
      workOrderNumber: workOrder.workOrderNumber,
      brandSnapshot: brand,
      template: {
        templateId: 'ELANKAV-WORK-ORDER',
        templateVersion: '1.0.0',
        layoutMode: 'automatic'
      },
      publicDocument: {
        ...workOrder,
        brandSnapshot: brand,
        internalData: undefined
      }
    };
  }
}

module.exports = { WorkOrderDocumentBuilder };
