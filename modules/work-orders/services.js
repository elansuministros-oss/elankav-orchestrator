const { createWorkOrderContract } = require('./contract');
const { mapWorkOrderContractToRow, toPublicWorkOrder } = require('./entities');
const {
  validateWorkOrderContract,
  validateWorkOrderPatch,
  validateWorkOrderStatusChange
} = require('./validators');
const { WorkOrderDocumentBuilder } = require('./documents/WorkOrderDocumentBuilder');

class WorkOrderService {
  constructor({ repository, documentBuilder, lineageNumberService } = {}) {
    if (!repository) throw new Error('WorkOrderService requiere repository');
    this.repository = repository;
    this.documentBuilder = documentBuilder || new WorkOrderDocumentBuilder();
    this.lineageNumberService = lineageNumberService || null;
  }

  async create(input = {}, actor = {}) {
    const contract = createWorkOrderContract({
      ...input,
      audit: {
        ...input.audit,
        createdBy: actor.userId || input.audit?.createdBy || '',
        updatedBy: actor.userId || input.audit?.updatedBy || ''
      }
    });
    const validation = validateWorkOrderContract(contract);
    if (!validation.ok) {
      const error = new Error(`Orden de trabajo invalida: ${validation.errors.join('; ')}`);
      error.code = 'WORK_ORDER_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    if (this.lineageNumberService) {
      const assignment = await this.lineageNumberService.assignWorkOrderLineage(contract, actor);
      contract.workOrder.workOrderNumber = assignment.documentNumber;
      contract.lineage = assignment.lineage;
    }

    const row = mapWorkOrderContractToRow(contract);
    const snapshotWorkOrder = toPublicWorkOrder({
      ...row,
      id: row.id || '',
      work_order_number: row.work_order_number || contract.workOrder.workOrderNumber || ''
    });
    row.document_snapshot = this.documentBuilder.build({ workOrder: snapshotWorkOrder });

    const created = await this.repository.create(row);
    const workOrder = toPublicWorkOrder(created);
    await this.recordAudit({
      documentId: workOrder.id,
      caseId: workOrder.lineage?.caseId,
      action: 'work_order.created',
      newStatus: workOrder.status,
      actor,
      platformId: workOrder.platformId
    });
    return {
      workOrder,
      document: this.documentBuilder.build({ workOrder })
    };
  }

  async list(filters = {}) {
    const rows = await this.repository.list(filters);
    return rows.map(toPublicWorkOrder);
  }

  async getById(id) {
    const row = await this.repository.getById(id);
    return row ? toPublicWorkOrder(row) : null;
  }

  async update(id, input = {}, actor = {}) {
    const current = await this.repository.getById(id);
    if (!current) return null;
    const validation = validateWorkOrderPatch(input);
    if (!validation.ok) {
      const error = new Error(`Actualizacion de orden de trabajo invalida: ${validation.errors.join('; ')}`);
      error.code = 'WORK_ORDER_UPDATE_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const updated = await this.repository.update(id, {
      ...validation.patch,
      updated_by: actor.userId || null
    });
    return toPublicWorkOrder(updated);
  }

  async changeStatus(id, status, actor = {}) {
    const current = await this.repository.getById(id);
    if (!current) return null;
    const validation = validateWorkOrderStatusChange(current.status, status);
    if (!validation.ok) {
      const error = new Error(`Cambio de estado invalido: ${validation.errors.join('; ')}`);
      error.code = 'WORK_ORDER_STATUS_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const patch = {
      status,
      updated_by: actor.userId || null
    };
    if (status === 'completed') patch.completed_at = new Date().toISOString();
    const updated = await this.repository.update(id, patch);
    const workOrder = toPublicWorkOrder(updated);
    await this.recordAudit({
      documentId: workOrder.id,
      caseId: workOrder.lineage?.caseId,
      action: 'work_order.status_changed',
      previousStatus: current.status,
      newStatus: workOrder.status,
      actor,
      platformId: workOrder.platformId
    });
    return workOrder;
  }

  async recordAudit(event = {}) {
    if (!this.lineageNumberService || typeof this.lineageNumberService.recordAudit !== 'function') return null;
    return this.lineageNumberService.recordAudit({
      documentType: 'work_order',
      ...event
    });
  }
}

module.exports = { WorkOrderService };
