const { createPurchaseOrderContract } = require('./contract');
const { mapPurchaseOrderContractToRow, toPublicPurchaseOrder } = require('./entities');
const {
  validatePurchaseOrderContract,
  validatePurchaseOrderPatch,
  validatePurchaseOrderStatusChange
} = require('./validators');
const { PurchaseOrderDocumentBuilder } = require('./documents/PurchaseOrderDocumentBuilder');

class PurchaseOrderService {
  constructor({ repository, documentBuilder, lineageNumberService } = {}) {
    if (!repository) throw new Error('PurchaseOrderService requiere repository');
    this.repository = repository;
    this.documentBuilder = documentBuilder || new PurchaseOrderDocumentBuilder();
    this.lineageNumberService = lineageNumberService || null;
  }

  async create(input = {}, actor = {}) {
    const contract = createPurchaseOrderContract({
      ...input,
      audit: {
        ...input.audit,
        createdBy: actor.userId || input.audit?.createdBy || '',
        updatedBy: actor.userId || input.audit?.updatedBy || ''
      }
    });
    const validation = validatePurchaseOrderContract(contract);
    if (!validation.ok) {
      const error = new Error(`Orden de compra invalida: ${validation.errors.join('; ')}`);
      error.code = 'PURCHASE_ORDER_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    if (this.lineageNumberService) {
      const assignment = await this.lineageNumberService.assignPurchaseOrderLineage(contract, actor);
      contract.purchaseOrder.purchaseOrderNumber = assignment.documentNumber;
      contract.lineage = assignment.lineage;
    }

    const row = mapPurchaseOrderContractToRow(contract);
    const snapshotPurchaseOrder = toPublicPurchaseOrder({
      ...row,
      id: row.id || '',
      purchase_order_number: row.purchase_order_number || contract.purchaseOrder.purchaseOrderNumber || ''
    });
    row.document_snapshot = this.documentBuilder.build({ purchaseOrder: snapshotPurchaseOrder });

    const created = await this.repository.create(row);
    const purchaseOrder = toPublicPurchaseOrder(created);
    await this.recordAudit({
      documentId: purchaseOrder.id,
      caseId: purchaseOrder.lineage?.caseId,
      action: 'purchase_order.created',
      newStatus: purchaseOrder.status,
      actor,
      platformId: purchaseOrder.platformId
    });
    return {
      purchaseOrder,
      document: this.documentBuilder.build({ purchaseOrder })
    };
  }

  async list(filters = {}) {
    const rows = await this.repository.list(filters);
    return rows.map(toPublicPurchaseOrder);
  }

  async getById(id) {
    const row = await this.repository.getById(id);
    return row ? toPublicPurchaseOrder(row) : null;
  }

  async update(id, input = {}, actor = {}) {
    const current = await this.repository.getById(id);
    if (!current) return null;
    const validation = validatePurchaseOrderPatch(input);
    if (!validation.ok) {
      const error = new Error(`Actualizacion de orden de compra invalida: ${validation.errors.join('; ')}`);
      error.code = 'PURCHASE_ORDER_UPDATE_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const updated = await this.repository.update(id, {
      ...validation.patch,
      updated_by: actor.userId || null
    });
    return toPublicPurchaseOrder(updated);
  }

  async changeStatus(id, status, actor = {}) {
    const current = await this.repository.getById(id);
    if (!current) return null;
    const validation = validatePurchaseOrderStatusChange(current.status, status);
    if (!validation.ok) {
      const error = new Error(`Cambio de estado invalido: ${validation.errors.join('; ')}`);
      error.code = 'PURCHASE_ORDER_STATUS_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const patch = { status, updated_by: actor.userId || null };
    const previousStatus = current.status;
    if (status === 'approved') patch.approved_at = new Date().toISOString();
    if (status === 'ordered') patch.ordered_at = new Date().toISOString();
    if (status === 'received') patch.received_at = new Date().toISOString();
    const updated = await this.repository.update(id, patch);
    const purchaseOrder = toPublicPurchaseOrder(updated);
    await this.recordAudit({
      documentId: purchaseOrder.id,
      caseId: purchaseOrder.lineage?.caseId,
      action: 'purchase_order.status_changed',
      previousStatus,
      newStatus: purchaseOrder.status,
      actor,
      platformId: purchaseOrder.platformId
    });
    return purchaseOrder;
  }

  approve(id, actor = {}) {
    return this.changeStatus(id, 'approved', actor);
  }

  async receive(id, input = {}, actor = {}) {
    const current = await this.repository.getById(id);
    if (!current) return null;
    const nextStatus = input.partial ? 'partially_received' : 'received';
    const validation = validatePurchaseOrderStatusChange(current.status, nextStatus);
    if (!validation.ok) {
      const error = new Error(`Recepcion invalida: ${validation.errors.join('; ')}`);
      error.code = 'PURCHASE_ORDER_RECEIVE_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const now = new Date().toISOString();
    const previousStatus = current.status;
    const receipt = {
      id: input.receiptId || `receipt-${Date.now()}`,
      receivedAt: input.receivedAt || now,
      receivedBy: actor.userId || input.receivedBy || '',
      notes: input.notes || '',
      items: Array.isArray(input.items) ? input.items : []
    };
    const receipts = [...(Array.isArray(current.receipts) ? current.receipts : []), receipt];
    const patch = {
      status: nextStatus,
      receipts,
      received_at: nextStatus === 'received' ? now : current.received_at || null,
      updated_by: actor.userId || null
    };
    const updated = await this.repository.receive(id, {
      row: {
        purchase_order_id: id,
        received_by: actor.userId || input.receivedBy || null,
        received_at: receipt.receivedAt,
        items: receipt.items,
        notes: receipt.notes || null
      },
      patch
    });
    const purchaseOrder = toPublicPurchaseOrder(updated);
    await this.recordAudit({
      documentId: purchaseOrder.id,
      caseId: purchaseOrder.lineage?.caseId,
      action: 'purchase_order.received',
      previousStatus,
      newStatus: purchaseOrder.status,
      actor,
      platformId: purchaseOrder.platformId
    });
    return purchaseOrder;
  }

  async recordAudit(event = {}) {
    if (!this.lineageNumberService || typeof this.lineageNumberService.recordAudit !== 'function') return null;
    return this.lineageNumberService.recordAudit({
      documentType: 'purchase_order',
      ...event
    });
  }
}

module.exports = { PurchaseOrderService };
