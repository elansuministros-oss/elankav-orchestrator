function toPublicMasterCase(row = {}) {
  return {
    caseId: row.id || row.case_id || '',
    caseNumber: row.case_number || '',
    platformId: row.platform_id || '',
    caseType: row.case_type || '',
    originType: row.origin_type || '',
    originId: row.origin_id || '',
    quotationId: row.quotation_id || '',
    quotationNumber: row.quotation_number || '',
    baseSequence: row.base_sequence || '',
    status: row.status || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function mapMasterCaseContractToRow(document = {}) {
  const row = {
    id: document.caseId || undefined,
    case_number: document.caseNumber || null,
    platform_id: document.platformId,
    case_type: document.caseType,
    origin_type: document.originType,
    origin_id: document.originId || null,
    quotation_id: document.quotationId || null,
    quotation_number: document.quotationNumber || null,
    base_sequence: document.baseSequence || null,
    status: document.status,
    contract_version: document.contractVersion,
    created_by: document.createdBy || null
  };

  Object.keys(row).forEach((key) => {
    if (row[key] === undefined) delete row[key];
  });

  return row;
}

module.exports = {
  toPublicMasterCase,
  mapMasterCaseContractToRow
};
