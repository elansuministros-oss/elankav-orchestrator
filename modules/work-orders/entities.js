function toPublicWorkOrder(row = {}) {
  return {
    id: row.id || '',
    workOrderNumber: row.work_order_number || '',
    platformId: row.platform_id || '',
    status: row.status || '',
    title: row.title || '',
    priority: row.priority || 'normal',
    source: {
      type: row.source_type || 'manual',
      sourceId: row.source_id || '',
      quotationId: row.source_quotation_id || '',
      projectId: row.source_project_id || ''
    },
    customer: row.customer_snapshot || {},
    project: row.project_snapshot || {},
    productionScope: row.production_scope || {},
    items: Array.isArray(row.items) ? row.items : [],
    schedule: row.schedule || {},
    quality: row.quality || {},
    documentSnapshot: row.document_snapshot || null,
    metadata: row.metadata || {},
    issuedAt: row.issued_at || '',
    scheduledStartAt: row.scheduled_start_at || '',
    scheduledEndAt: row.scheduled_end_at || '',
    completedAt: row.completed_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function mapWorkOrderContractToRow(document = {}) {
  const row = {
    id: document.workOrder?.workOrderId || undefined,
    platform_id: document.workOrder?.platformId,
    status: document.workOrder?.status,
    title: document.workOrder?.title,
    priority: document.workOrder?.priority,
    source_type: document.source?.type,
    source_id: document.source?.sourceId || null,
    source_quotation_id: document.source?.quotationId || null,
    source_project_id: document.source?.projectId || null,
    customer_snapshot: document.customerSnapshot || {},
    project_snapshot: document.projectSnapshot || {},
    production_scope: document.productionScope || {},
    items: document.items || [],
    schedule: document.schedule || {},
    quality: document.quality || {},
    metadata: document.metadata || {},
    issued_at: document.workOrder?.issuedAt,
    scheduled_start_at: document.workOrder?.scheduledStartAt || null,
    scheduled_end_at: document.workOrder?.scheduledEndAt || null,
    completed_at: document.workOrder?.completedAt || null,
    contract_version: document.contractVersion,
    created_by: document.audit?.createdBy || null,
    updated_by: document.audit?.updatedBy || document.audit?.createdBy || null
  };

  if (document.workOrder?.workOrderNumber) {
    row.work_order_number = document.workOrder.workOrderNumber;
  }

  return row;
}

module.exports = {
  toPublicWorkOrder,
  mapWorkOrderContractToRow
};
