const MASTER_CASE_CONTRACT_VERSION = '1.0.0';

const MASTER_CASE_TYPES = Object.freeze([
  'commercial',
  'internal_purchase',
  'inventory',
  'maintenance',
  'internal_work'
]);

const MASTER_CASE_ORIGIN_TYPES = Object.freeze([
  'quotation',
  'manual_purchase',
  'manual_work_order',
  'purchase_request'
]);

const MASTER_CASE_STATUSES = Object.freeze([
  'open',
  'active',
  'completed',
  'cancelled'
]);

function createMasterCaseContract(input = {}) {
  const now = new Date().toISOString();
  return {
    contractVersion: MASTER_CASE_CONTRACT_VERSION,
    caseId: input.caseId || '',
    caseNumber: input.caseNumber || '',
    platformId: input.platformId || 'ELANVISUAL',
    caseType: MASTER_CASE_TYPES.includes(input.caseType) ? input.caseType : 'internal_work',
    originType: MASTER_CASE_ORIGIN_TYPES.includes(input.originType) ? input.originType : 'manual_work_order',
    originId: input.originId || '',
    quotationId: input.quotationId || '',
    quotationNumber: input.quotationNumber || '',
    baseSequence: input.baseSequence || '',
    status: MASTER_CASE_STATUSES.includes(input.status) ? input.status : 'open',
    createdBy: input.createdBy || '',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

module.exports = {
  MASTER_CASE_CONTRACT_VERSION,
  MASTER_CASE_TYPES,
  MASTER_CASE_ORIGIN_TYPES,
  MASTER_CASE_STATUSES,
  createMasterCaseContract
};
