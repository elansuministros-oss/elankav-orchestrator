const { WORK_ORDER_STATUSES } = require('./states');

const WORK_ORDER_CONTRACT_VERSION = '1.0.0';
const WORK_ORDER_SOURCE_TYPES = Object.freeze(['manual', 'quotation', 'project']);
const ACTIVE_WORK_ORDER_SOURCE_TYPES = Object.freeze(['manual', 'quotation']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSource(source = {}) {
  const type = WORK_ORDER_SOURCE_TYPES.includes(source.type) ? source.type : 'manual';
  return {
    type,
    sourceId: source.sourceId || '',
    quotationId: source.quotationId || '',
    projectId: source.projectId || '',
    mapperVersion: source.mapperVersion || ''
  };
}

function normalizeLineage(lineage = {}, source = {}) {
  return {
    caseId: lineage.caseId || '',
    caseNumber: lineage.caseNumber || '',
    baseSequence: lineage.baseSequence || '',
    originType: lineage.originType || source.type || 'manual',
    originId: lineage.originId || source.sourceId || source.quotationId || source.projectId || '',
    quotationId: lineage.quotationId || source.quotationId || '',
    quotationNumber: lineage.quotationNumber || ''
  };
}

function createWorkOrderContract(input = {}) {
  const now = new Date().toISOString();
  const source = normalizeSource(input.source);

  return {
    contractVersion: WORK_ORDER_CONTRACT_VERSION,
    workOrder: {
      workOrderId: input.workOrder?.workOrderId || '',
      workOrderNumber: input.workOrder?.workOrderNumber || '',
      platformId: input.workOrder?.platformId || input.platformId || 'ELANVISUAL',
      status: WORK_ORDER_STATUSES.includes(input.workOrder?.status) ? input.workOrder.status : 'draft',
      title: input.workOrder?.title || input.title || '',
      priority: input.workOrder?.priority || 'normal',
      issuedAt: input.workOrder?.issuedAt || now,
      scheduledStartAt: input.workOrder?.scheduledStartAt || '',
      scheduledEndAt: input.workOrder?.scheduledEndAt || '',
      completedAt: input.workOrder?.completedAt || ''
    },
    source,
    lineage: normalizeLineage(input.lineage, source),
    customerSnapshot: {
      customerId: input.customerSnapshot?.customerId || '',
      name: input.customerSnapshot?.name || '',
      companyName: input.customerSnapshot?.companyName || '',
      phone: input.customerSnapshot?.phone || '',
      email: input.customerSnapshot?.email || '',
      address: input.customerSnapshot?.address || '',
      taxId: input.customerSnapshot?.taxId || ''
    },
    projectSnapshot: {
      projectId: input.projectSnapshot?.projectId || '',
      projectNumber: input.projectSnapshot?.projectNumber || '',
      title: input.projectSnapshot?.title || '',
      location: input.projectSnapshot?.location || '',
      expectedDeliveryAt: input.projectSnapshot?.expectedDeliveryAt || ''
    },
    productionScope: {
      summary: input.productionScope?.summary || '',
      technicalNotes: input.productionScope?.technicalNotes || '',
      deliverables: asArray(input.productionScope?.deliverables).map((entry) => String(entry || '').trim()).filter(Boolean),
      attachments: asArray(input.productionScope?.attachments)
    },
    items: asArray(input.items).map((item, index) => ({
      itemId: item.itemId || item.id || `wo-item-${index + 1}`,
      title: item.title || `Item ${index + 1}`,
      description: item.description || '',
      quantity: asNumber(item.quantity, 1),
      unit: item.unit || 'unidad',
      materials: asArray(item.materials),
      instructions: item.instructions || '',
      images: asArray(item.images)
    })),
    schedule: {
      productionDueAt: input.schedule?.productionDueAt || '',
      installationDueAt: input.schedule?.installationDueAt || '',
      assignedTeam: asArray(input.schedule?.assignedTeam).map((member) => ({
        id: member.id || '',
        name: member.name || '',
        role: member.role || ''
      }))
    },
    quality: {
      checklist: asArray(input.quality?.checklist).map((entry, index) => ({
        id: entry.id || `quality-${index + 1}`,
        label: entry.label || entry.name || '',
        required: entry.required !== false
      })),
      notes: input.quality?.notes || ''
    },
    metadata: {
      ...(input.metadata || {}),
      futureSourcesPrepared: ['quotation', 'project']
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
  WORK_ORDER_CONTRACT_VERSION,
  WORK_ORDER_SOURCE_TYPES,
  ACTIVE_WORK_ORDER_SOURCE_TYPES,
  createWorkOrderContract
};
