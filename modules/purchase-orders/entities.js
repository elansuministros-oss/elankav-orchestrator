function toPublicPurchaseOrder(row = {}) {
  return {
    id: row.id || '',
    purchaseOrderNumber: row.purchase_order_number || '',
    platformId: row.platform_id || '',
    status: row.status || '',
    title: row.title || '',
    source: {
      type: row.source_type || 'manual',
      sourceId: row.source_id || '',
      workOrderId: row.source_work_order_id || '',
      quotationId: row.source_quotation_id || '',
      purchaseRequestId: row.source_purchase_request_id || ''
    },
    lineage: row.lineage || {
      caseId: row.case_id || '',
      caseNumber: row.case_number || '',
      baseSequence: row.base_sequence || '',
      originType: row.source_type || 'manual',
      originId: row.source_id || row.source_work_order_id || row.source_quotation_id || row.source_purchase_request_id || '',
      quotationId: row.quotation_id || row.source_quotation_id || '',
      quotationNumber: row.quotation_number || ''
    },
    supplier: row.supplier_snapshot || {},
    requester: row.requester_snapshot || {},
    project: row.project_snapshot || {},
    items: Array.isArray(row.items) ? row.items : [],
    totals: row.totals || {},
    delivery: row.delivery || {},
    approvals: row.approvals || {},
    receipts: Array.isArray(row.receipts) ? row.receipts : [],
    documentSnapshot: row.document_snapshot || null,
    metadata: row.metadata || {},
    issuedAt: row.issued_at || '',
    requiredBy: row.required_by || '',
    approvedAt: row.approved_at || '',
    orderedAt: row.ordered_at || '',
    receivedAt: row.received_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function mapPurchaseOrderContractToRow(document = {}) {
  const row = {
    id: document.purchaseOrder?.purchaseOrderId || undefined,
    platform_id: document.purchaseOrder?.platformId,
    status: document.purchaseOrder?.status,
    title: document.purchaseOrder?.title,
    source_type: document.source?.type,
    source_id: document.source?.sourceId || null,
    source_work_order_id: document.source?.workOrderId || null,
    source_quotation_id: document.source?.quotationId || null,
    source_purchase_request_id: document.source?.purchaseRequestId || null,
    case_id: document.lineage?.caseId || null,
    case_number: document.lineage?.caseNumber || null,
    base_sequence: document.lineage?.baseSequence || null,
    quotation_id: document.lineage?.quotationId || document.source?.quotationId || null,
    quotation_number: document.lineage?.quotationNumber || null,
    lineage: document.lineage || {},
    supplier_id: document.supplierSnapshot?.supplierId || null,
    supplier_snapshot: document.supplierSnapshot || {},
    requester_snapshot: document.requesterSnapshot || {},
    project_snapshot: document.projectSnapshot || {},
    items: document.items || [],
    totals: document.totals || {},
    delivery: document.delivery || {},
    approvals: document.approvals || {},
    receipts: document.receipts || [],
    metadata: document.metadata || {},
    issued_at: document.purchaseOrder?.issuedAt,
    required_by: document.purchaseOrder?.requiredBy || null,
    contract_version: document.contractVersion,
    created_by: document.audit?.createdBy || null,
    updated_by: document.audit?.updatedBy || document.audit?.createdBy || null
  };

  if (document.purchaseOrder?.purchaseOrderNumber) {
    row.purchase_order_number = document.purchaseOrder.purchaseOrderNumber;
  }

  Object.keys(row).forEach((key) => {
    if (row[key] === undefined) delete row[key];
  });

  return row;
}

module.exports = {
  toPublicPurchaseOrder,
  mapPurchaseOrderContractToRow
};
