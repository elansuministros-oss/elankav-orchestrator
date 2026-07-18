const { WorkOrderDocumentBuilder } = require('../vqs/workOrderDocumentBuilder');

class OperationalOrdersDocumentService {
  constructor({ ordersService, documentBuilder } = {}) {
    if (!ordersService) throw new Error('OperationalOrdersDocumentService requiere ordersService');
    this.ordersService = ordersService;
    this.documentBuilder = documentBuilder || new WorkOrderDocumentBuilder();
  }

  async createWorkOrder(projectId, input = {}, actor = {}) {
    const workOrder = await this.ordersService.createWorkOrder(projectId, input, actor);
    const project = await this.ordersService.adapter.getProjectById(projectId);
    const officialDocument = this.documentBuilder.build({
      workOrder: {
        ...workOrder,
        platformId: project?.platform_id,
        payload: workOrder.payload || {}
      },
      project
    });

    if (workOrder.payload?.officialDocument) return workOrder;

    return this.ordersService.updateWorkOrder(projectId, workOrder.id, {
      payload: { officialDocument }
    }, actor);
  }

  getWorkOrder(...args) { return this.ordersService.getWorkOrder(...args); }
  listWorkOrders(...args) { return this.ordersService.listWorkOrders(...args); }
  updateWorkOrder(...args) { return this.ordersService.updateWorkOrder(...args); }
  createPurchaseOrder(...args) { return this.ordersService.createPurchaseOrder(...args); }
  getPurchaseOrder(...args) { return this.ordersService.getPurchaseOrder(...args); }
  listPurchaseOrders(...args) { return this.ordersService.listPurchaseOrders(...args); }
  updatePurchaseOrder(...args) { return this.ordersService.updatePurchaseOrder(...args); }
}

module.exports = { OperationalOrdersDocumentService };
