const { getPlatformBrand } = require('../../../adapters/vqs/brandRegistryAdapter');

class PurchaseOrderDocumentBuilder {
  build({ purchaseOrder } = {}) {
    if (!purchaseOrder?.platformId) {
      const error = new Error('purchaseOrder.platformId es obligatorio');
      error.code = 'PURCHASE_ORDER_DOCUMENT_INPUT_INVALID';
      throw error;
    }

    const brand = getPlatformBrand(purchaseOrder.platformId);
    if (!brand) {
      const error = new Error(`Plataforma no registrada: ${purchaseOrder.platformId}`);
      error.code = 'PURCHASE_ORDER_PLATFORM_NOT_FOUND';
      throw error;
    }

    return {
      schemaVersion: '1.0.0',
      documentType: 'purchase_order',
      platformId: brand.platformId,
      purchaseOrderNumber: purchaseOrder.purchaseOrderNumber,
      brandSnapshot: brand,
      template: {
        templateId: 'ELANKAV-PURCHASE-ORDER',
        templateVersion: '1.0.0',
        layoutMode: 'automatic'
      },
      publicDocument: {
        ...purchaseOrder,
        brandSnapshot: brand,
        internalData: undefined
      }
    };
  }
}

module.exports = { PurchaseOrderDocumentBuilder };
