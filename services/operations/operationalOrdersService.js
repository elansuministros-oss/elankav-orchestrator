const WORK_ORDER_STATES = Object.freeze([
  'pending',
  'scheduled',
  'in_progress',
  'paused',
  'completed',
  'cancelled'
]);

const PURCHASE_ORDER_STATES = Object.freeze([
  'draft',
  'pending_approval',
  'approved',
  'ordered',
  'partially_received',
  'received',
  'cancelled'
]);

function requiredText(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    const error = new Error(`${field} es obligatorio`);
    error.code = 'OPERATIONAL_ORDER_VALIDATION_ERROR';
    error.details = [field];
    throw error;
  }
  return normalized;
}

function publicWorkOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    workOrderNumber: row.work_order_number,
    projectId: row.project_id,
    quotationId: row.quotation_id,
    generatedBy: row.generated_by,
    generatedByRole: row.generated_by_role,
    status: row.status,
    payload: row.payload || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicPurchaseOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    purchaseOrderNumber: row.purchase_order_number,
    projectId: row.project_id,
    supplierId: row.supplier_id,
    generatedBy: row.generated_by,
    status: row.status,
    blocksProduction: Boolean(row.blocks_production),
    expectedAt: row.expected_at,
    payload: row.payload || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class OperationalOrdersService {
  constructor({ adapter } = {}) {
    if (!adapter) throw new Error('OperationalOrdersService requiere adapter');
    this.adapter = adapter;
  }

  async createWorkOrder(projectId, input = {}, actor = {}) {
    const project = await this.adapter.getProjectById(requiredText(projectId, 'projectId'));
    if (!project) {
      const error = new Error('Proyecto no encontrado');
      error.code = 'PROJECT_NOT_FOUND';
      throw error;
    }

    const quotationId = input.quotationId || project.quotation_id;
    if (String(quotationId) !== String(project.quotation_id)) {
      const error = new Error('La cotización no corresponde al proyecto');
      error.code = 'WORK_ORDER_LINEAGE_INVALID';
      throw error;
    }

    const existing = await this.adapter.listWorkOrders({ projectId: project.id, quotationId, limit: 1 });
    if (existing.length) return publicWorkOrder(existing[0]);

    const row = await this.adapter.createWorkOrder({
      projectId: project.id,
      quotationId,
      generatedBy: actor.userId || input.generatedBy || 'ELANVISUAL',
      generatedByRole: actor.role || input.generatedByRole || 'ventas',
      payload: {
        projectNumber: project.project_number,
        title: project.title || '',
        customer: project.customer_snapshot || {},
        ...(input.payload || {})
      }
    });

    await this.adapter.appendEvent({
      quotation_id: quotationId,
      project_id: project.id,
      event_type: 'work_order.created',
      actor_type: actor.type || 'user',
      actor_user_id: actor.userId || null,
      actor_role: actor.role || null,
      actor_executive_id: actor.executiveId || null,
      platform_id: project.platform_id || actor.platformId || null,
      payload: { workOrderId: row.id, workOrderNumber: row.work_order_number }
    });

    return publicWorkOrder(row);
  }

  async getWorkOrder(projectId, workOrderId) {
    const row = await this.adapter.getWorkOrderById(requiredText(workOrderId, 'workOrderId'));
    if (!row || String(row.project_id) !== String(projectId)) return null;
    return publicWorkOrder(row);
  }

  async listWorkOrders(projectId, filters = {}) {
    const rows = await this.adapter.listWorkOrders({ projectId, status: filters.status, limit: filters.limit || 100 });
    return rows.map(publicWorkOrder);
  }

  async updateWorkOrder(projectId, workOrderId, patch = {}) {
    const current = await this.adapter.getWorkOrderById(requiredText(workOrderId, 'workOrderId'));
    if (!current || String(current.project_id) !== String(projectId)) return null;
    const update = {};
    if (Object.hasOwn(patch, 'status')) {
      if (!WORK_ORDER_STATES.includes(patch.status)) {
        const error = new Error('Estado OT no autorizado');
        error.code = 'WORK_ORDER_STATUS_INVALID';
        throw error;
      }
      update.status = patch.status;
    }
    if (Object.hasOwn(patch, 'payload')) update.payload = { ...(current.payload || {}), ...(patch.payload || {}) };
    if (!Object.keys(update).length) {
      const error = new Error('No hay campos autorizados para actualizar');
      error.code = 'OPERATIONAL_ORDER_VALIDATION_ERROR';
      throw error;
    }
    return publicWorkOrder(await this.adapter.updateWorkOrder(workOrderId, update));
  }

  async createPurchaseOrder(projectId, input = {}, actor = {}) {
    const project = await this.adapter.getProjectById(requiredText(projectId, 'projectId'));
    if (!project) {
      const error = new Error('Proyecto no encontrado');
      error.code = 'PROJECT_NOT_FOUND';
      throw error;
    }

    const supplierId = requiredText(input.supplierId, 'supplierId');
    const row = await this.adapter.createPurchaseOrder({
      projectId: project.id,
      supplierId,
      generatedBy: actor.userId || input.generatedBy || 'ELANVISUAL',
      payload: {
        projectNumber: project.project_number,
        title: project.title || '',
        ...(input.payload || {})
      }
    });

    await this.adapter.appendEvent({
      quotation_id: project.quotation_id,
      project_id: project.id,
      event_type: 'purchase_order.created',
      actor_type: actor.type || 'user',
      actor_user_id: actor.userId || null,
      actor_role: actor.role || null,
      actor_executive_id: actor.executiveId || null,
      platform_id: project.platform_id || actor.platformId || null,
      payload: { purchaseOrderId: row.id, purchaseOrderNumber: row.purchase_order_number, supplierId }
    });

    return publicPurchaseOrder(row);
  }

  async getPurchaseOrder(projectId, purchaseOrderId) {
    const row = await this.adapter.getPurchaseOrderById(requiredText(purchaseOrderId, 'purchaseOrderId'));
    if (!row || String(row.project_id) !== String(projectId)) return null;
    return publicPurchaseOrder(row);
  }

  async listPurchaseOrders(projectId, filters = {}) {
    const rows = await this.adapter.listPurchaseOrders({ projectId, supplierId: filters.supplierId, status: filters.status, limit: filters.limit || 100 });
    return rows.map(publicPurchaseOrder);
  }

  async updatePurchaseOrder(projectId, purchaseOrderId, patch = {}) {
    const current = await this.adapter.getPurchaseOrderById(requiredText(purchaseOrderId, 'purchaseOrderId'));
    if (!current || String(current.project_id) !== String(projectId)) return null;
    const update = {};
    if (Object.hasOwn(patch, 'status')) {
      if (!PURCHASE_ORDER_STATES.includes(patch.status)) {
        const error = new Error('Estado OC no autorizado');
        error.code = 'PURCHASE_ORDER_STATUS_INVALID';
        throw error;
      }
      update.status = patch.status;
    }
    if (Object.hasOwn(patch, 'expectedAt')) update.expected_at = patch.expectedAt || null;
    if (Object.hasOwn(patch, 'blocksProduction')) update.blocks_production = Boolean(patch.blocksProduction);
    if (Object.hasOwn(patch, 'payload')) update.payload = { ...(current.payload || {}), ...(patch.payload || {}) };
    if (!Object.keys(update).length) {
      const error = new Error('No hay campos autorizados para actualizar');
      error.code = 'OPERATIONAL_ORDER_VALIDATION_ERROR';
      throw error;
    }
    return publicPurchaseOrder(await this.adapter.updatePurchaseOrder(purchaseOrderId, update));
  }
}

module.exports = {
  OperationalOrdersService,
  WORK_ORDER_STATES,
  PURCHASE_ORDER_STATES,
  publicWorkOrder,
  publicPurchaseOrder
};
