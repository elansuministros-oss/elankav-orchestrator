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

function unwrap(result, context) {
  if (result?.error) {
    const error = new Error(`${context}: ${result.error.message || 'error de Supabase'}`);
    error.code = result.error.code || 'SUPABASE_ERROR';
    error.cause = result.error;
    throw error;
  }
  return result?.data ?? null;
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

function projectCreditAuthorization(project = {}) {
  const candidates = [
    project.credit_authorization,
    project.creditAuthorization,
    project.metadata?.creditAuthorization,
    project.metadata?.credit_authorization,
    project.payload?.creditAuthorization,
    project.payload?.credit_authorization,
    project.commercial_terms?.creditAuthorization,
    project.commercial_terms?.credit_authorization
  ];
  const credit = candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  if (!credit) return null;

  const status = String(credit.status || '').trim().toLowerCase();
  const approved = credit.approved === true || status === 'approved' || status === 'active';
  if (!approved) return null;

  const dueAt = credit.dueAt || credit.due_at || credit.expiresAt || credit.expires_at || null;
  const dueDate = dueAt ? new Date(dueAt) : null;
  const approvedBy = String(credit.approvedBy || credit.approved_by || '').trim();
  const creditDays = Number(credit.creditDays ?? credit.credit_days ?? 0);

  return {
    authorizationId: String(credit.id || credit.authorizationId || credit.authorization_id || '').trim() || null,
    approvedBy: approvedBy || null,
    approvedAt: credit.approvedAt || credit.approved_at || null,
    creditDays: Number.isFinite(creditDays) && creditDays > 0 ? creditDays : null,
    dueAt: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString() : null,
    expired: Boolean(dueDate && !Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now())
  };
}

class OperationalOrdersService {
  constructor({ adapter, paymentAdapter } = {}) {
    if (!adapter) throw new Error('OperationalOrdersService requiere adapter');
    if (!adapter.supabase || !adapter.tables) throw new Error('OperationalOrdersService requiere adapter Supabase oficial');
    this.adapter = adapter;
    this.paymentAdapter = paymentAdapter || null;
  }

  async createWorkOrderRow({ projectId, quotationId, generatedBy, generatedByRole, payload }) {
    const result = await this.adapter.supabase.rpc('elankav_create_work_order', {
      target_project_id: projectId,
      target_quotation_id: quotationId,
      target_generated_by: generatedBy,
      target_generated_by_role: generatedByRole,
      target_payload: payload || {}
    });
    const rows = unwrap(result, 'No se pudo crear la OT');
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async createPurchaseOrderRow({ projectId, supplierId, generatedBy, payload }) {
    const result = await this.adapter.supabase.rpc('elankav_create_purchase_order', {
      target_project_id: projectId,
      target_supplier_id: supplierId,
      target_generated_by: generatedBy,
      target_payload: payload || {}
    });
    const rows = unwrap(result, 'No se pudo crear la OC');
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async getWorkOrderRow(id) {
    const result = await this.adapter.supabase
      .from(this.adapter.tables.workOrders)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar la OT');
  }

  async updateWorkOrderRow(id, patch) {
    const result = await this.adapter.supabase
      .from(this.adapter.tables.workOrders)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    return unwrap(result, 'No se pudo actualizar la OT');
  }

  async getPurchaseOrderRow(id) {
    const result = await this.adapter.supabase
      .from(this.adapter.tables.purchaseOrders)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar la OC');
  }

  async updatePurchaseOrderRow(id, patch) {
    const result = await this.adapter.supabase
      .from(this.adapter.tables.purchaseOrders)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    return unwrap(result, 'No se pudo actualizar la OC');
  }

  async hasDepositCompleted(project) {
    if (!this.paymentAdapter?.listCustomerPayments) return false;
    const payments = await this.paymentAdapter.listCustomerPayments({
      projectId: project.id,
      quotationId: project.quotation_id,
      statuses: ['confirmed'],
      limit: 100
    });
    return payments.some((row) => Boolean(row.deposit_completed));
  }

  async assertFinancialAuthorization(project) {
    if (await this.hasDepositCompleted(project)) {
      return { type: 'deposit', status: 'confirmed' };
    }

    const credit = projectCreditAuthorization(project);
    if (credit?.expired) {
      const error = new Error('La autorización de crédito está vencida');
      error.code = 'CREDIT_AUTHORIZATION_EXPIRED';
      error.statusCode = 409;
      throw error;
    }
    if (credit) {
      return { type: 'credit', status: 'approved', ...credit };
    }

    if (!this.paymentAdapter?.listCustomerPayments) {
      const error = new Error('No existe adapter de pagos para validar la autorización financiera');
      error.code = 'PAYMENT_GATE_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }

    const error = new Error('Se requiere anticipo completado o crédito autorizado para generar la OT');
    error.code = 'FINANCIAL_AUTHORIZATION_REQUIRED_FOR_WORK_ORDER';
    error.statusCode = 409;
    throw error;
  }

  async assertWorkOrderExists(projectId) {
    const workOrders = await this.adapter.listWorkOrders({ projectId, limit: 1 });
    if (!workOrders.length) {
      const error = new Error('Debe existir una OT antes de crear una OC');
      error.code = 'WORK_ORDER_REQUIRED_FOR_PURCHASE_ORDER';
      error.statusCode = 409;
      throw error;
    }
    return workOrders[0];
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

    const financialAuthorization = await this.assertFinancialAuthorization(project);

    const row = await this.createWorkOrderRow({
      projectId: project.id,
      quotationId,
      generatedBy: actor.userId || input.generatedBy || 'ELANVISUAL',
      generatedByRole: actor.role || input.generatedByRole || 'ventas',
      payload: {
        projectNumber: project.project_number,
        title: project.title || '',
        customer: project.customer_snapshot || {},
        ...(input.payload || {}),
        financialAuthorization
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
      payload: { workOrderId: row.id, workOrderNumber: row.work_order_number, financialAuthorization }
    });

    return publicWorkOrder(row);
  }

  async getWorkOrder(projectId, workOrderId) {
    const row = await this.getWorkOrderRow(requiredText(workOrderId, 'workOrderId'));
    if (!row || String(row.project_id) !== String(projectId)) return null;
    return publicWorkOrder(row);
  }

  async listWorkOrders(projectId, filters = {}) {
    const rows = await this.adapter.listWorkOrders({ projectId, status: filters.status, limit: filters.limit || 100 });
    return rows.map(publicWorkOrder);
  }

  async updateWorkOrder(projectId, workOrderId, patch = {}) {
    const current = await this.getWorkOrderRow(requiredText(workOrderId, 'workOrderId'));
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
    return publicWorkOrder(await this.updateWorkOrderRow(workOrderId, update));
  }

  async createPurchaseOrder(projectId, input = {}, actor = {}) {
    const project = await this.adapter.getProjectById(requiredText(projectId, 'projectId'));
    if (!project) {
      const error = new Error('Proyecto no encontrado');
      error.code = 'PROJECT_NOT_FOUND';
      throw error;
    }

    const workOrder = await this.assertWorkOrderExists(project.id);
    const supplierId = requiredText(input.supplierId, 'supplierId');
    const row = await this.createPurchaseOrderRow({
      projectId: project.id,
      supplierId,
      generatedBy: actor.userId || input.generatedBy || 'ELANVISUAL',
      payload: {
        projectNumber: project.project_number,
        workOrderId: workOrder.id,
        quotationId: project.quotation_id,
        financialAuthorization: workOrder.payload?.financialAuthorization || null,
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
      payload: { purchaseOrderId: row.id, purchaseOrderNumber: row.purchase_order_number, supplierId, workOrderId: workOrder.id }
    });

    return publicPurchaseOrder(row);
  }

  async getPurchaseOrder(projectId, purchaseOrderId) {
    const row = await this.getPurchaseOrderRow(requiredText(purchaseOrderId, 'purchaseOrderId'));
    if (!row || String(row.project_id) !== String(projectId)) return null;
    return publicPurchaseOrder(row);
  }

  async listPurchaseOrders(projectId, filters = {}) {
    const rows = await this.adapter.listPurchaseOrders({ projectId, supplierId: filters.supplierId, status: filters.status, limit: filters.limit || 100 });
    return rows.map(publicPurchaseOrder);
  }

  async updatePurchaseOrder(projectId, purchaseOrderId, patch = {}) {
    const current = await this.getPurchaseOrderRow(requiredText(purchaseOrderId, 'purchaseOrderId'));
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
    return publicPurchaseOrder(await this.updatePurchaseOrderRow(purchaseOrderId, update));
  }
}

module.exports = {
  OperationalOrdersService,
  WORK_ORDER_STATES,
  PURCHASE_ORDER_STATES,
  publicWorkOrder,
  publicPurchaseOrder,
  projectCreditAuthorization
};