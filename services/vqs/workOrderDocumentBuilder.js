const { getPlatformBrand } = require('../../adapters/vqs/brandRegistryAdapter');

class WorkOrderDocumentBuilder {
  build({ workOrder, project } = {}) {
    const platformId = workOrder?.platformId || project?.platform_id;
    if (!platformId || !workOrder?.workOrderNumber) {
      const error = new Error('platformId y workOrderNumber son obligatorios');
      error.code = 'WORK_ORDER_DOCUMENT_INPUT_INVALID';
      throw error;
    }

    const brand = getPlatformBrand(platformId);
    if (!brand) {
      const error = new Error(`Plataforma no registrada: ${platformId}`);
      error.code = 'WORK_ORDER_PLATFORM_NOT_FOUND';
      throw error;
    }

    return {
      schemaVersion: '1.0.0',
      documentType: 'work_order',
      platformId: brand.platformId,
      workOrderNumber: workOrder.workOrderNumber,
      projectId: workOrder.projectId,
      projectNumber: project?.project_number || workOrder.payload?.projectNumber || '',
      quotationId: workOrder.quotationId,
      brandSnapshot: brand,
      template: {
        templateId: 'ELANKAV-WORK-ORDER',
        templateVersion: '1.0.0',
        layoutMode: 'automatic'
      },
      publicDocument: {
        workOrderNumber: workOrder.workOrderNumber,
        projectId: workOrder.projectId,
        projectNumber: project?.project_number || workOrder.payload?.projectNumber || '',
        quotationId: workOrder.quotationId,
        status: workOrder.status,
        title: project?.title || workOrder.payload?.title || '',
        customer: project?.customer_snapshot || workOrder.payload?.customer || {},
        items: Array.isArray(workOrder.payload?.items) ? workOrder.payload.items : [],
        instructions: Array.isArray(workOrder.payload?.instructions) ? workOrder.payload.instructions : [],
        generatedAt: new Date().toISOString(),
        brandSnapshot: brand
      }
    };
  }
}

module.exports = { WorkOrderDocumentBuilder };
