const { PURCHASE_ORDER_STATUSES } = require('./states');

const PURCHASE_ORDER_CONTRACT_VERSION = '1.0.0';
const PURCHASE_ORDER_SOURCE_TYPES = Object.freeze(['manual', 'workOrder', 'quotation', 'purchaseRequest']);
const ACTIVE_PURCHASE_ORDER_SOURCE_TYPES = Object.freeze(['manual']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSource(source = {}) {
  const type = PURCHASE_ORDER_SOURCE_TYPES.includes(source.type) ? source.type : 'manual';
  return {
    type,
    sourceId: source.sourceId || '',
    workOrderId: source.workOrderId || '',
    quotationId: source.quotationId || '',
    purchaseRequestId: source.purchaseRequestId || '',
    mapperVersion: source.mapperVersion || ''
  };
}

function createPurchaseOrderContract(input = {}) {
  const now = new Date().toISOString();
  const source = normalizeSource(input.source);

  return {
    contractVersion: PURCHASE_ORDER_CONTRACT_VERSION,
    purchaseOrder: {
      purchaseOrderId: input.purchaseOrder?.purchaseOrderId || '',
      purchaseOrderNumber: input.purchaseOrder?.purchaseOrderNumber || '',
      platformId: input.purchaseOrder?.platformId || input.platformId || 'ELANVISUAL',
      status: PURCHASE_ORDER_STATUSES.includes(input.purchaseOrder?.status) ? input.purchaseOrder.status : 'draft',
      title: input.purchaseOrder?.title || input.title || '',
      issuedAt: input.purchaseOrder?.issuedAt || now,
      requiredBy: input.purchaseOrder?.requiredBy || ''
    },
    source,
    supplierSnapshot: {
      supplierId: input.supplierSnapshot?.supplierId || '',
      name: input.supplierSnapshot?.name || '',
      contactName: input.supplierSnapshot?.contactName || '',
      phone: input.supplierSnapshot?.phone || '',
      email: input.supplierSnapshot?.email || '',
      taxId: input.supplierSnapshot?.taxId || ''
    },
    requesterSnapshot: {
      userId: input.requesterSnapshot?.userId || '',
      name: input.requesterSnapshot?.name || '',
      role: input.requesterSnapshot?.role || ''
    },
    projectSnapshot: {
      projectId: input.projectSnapshot?.projectId || '',
      projectNumber: input.projectSnapshot?.projectNumber || '',
      title: input.projectSnapshot?.title || ''
    },
    items: asArray(input.items).map((item, index) => ({
      itemId: item.itemId || item.id || `po-item-${index + 1}`,
      sku: item.sku || '',
      title: item.title || `Item ${index + 1}`,
      description: item.description || '',
      quantity: asNumber(item.quantity, 1),
      unit: item.unit || 'unidad',
      unitCost: item.unitCost === undefined || item.unitCost === null ? null : asNumber(item.unitCost),
      currency: item.currency || input.totals?.currency || 'USD',
      notes: item.notes || ''
    })),
    totals: {
      currency: input.totals?.currency || 'USD',
      subtotal: input.totals?.subtotal ?? null,
      tax: input.totals?.tax ?? null,
      total: input.totals?.total ?? null
    },
    delivery: {
      expectedAt: input.delivery?.expectedAt || '',
      address: input.delivery?.address || '',
      instructions: input.delivery?.instructions || ''
    },
    approvals: {
      requestedBy: input.approvals?.requestedBy || '',
      approvedBy: input.approvals?.approvedBy || '',
      approvedAt: input.approvals?.approvedAt || '',
      notes: input.approvals?.notes || ''
    },
    receipts: asArray(input.receipts),
    metadata: {
      ...(input.metadata || {}),
      futureSourcesPrepared: ['workOrder', 'quotation', 'purchaseRequest']
    },
    audit: {
      createdAt: input.audit?.createdAt || now,
      createdBy: input.audit?.createdBy || '',
      updatedAt: input.audit?.updatedAt || now,
      updatedBy: input.audit?.updatedBy || ''
    }
  };
}

module.exports = {
  PURCHASE_ORDER_CONTRACT_VERSION,
  PURCHASE_ORDER_SOURCE_TYPES,
  ACTIVE_PURCHASE_ORDER_SOURCE_TYPES,
  createPurchaseOrderContract
};
