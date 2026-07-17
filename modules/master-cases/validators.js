const {
  MASTER_CASE_TYPES,
  MASTER_CASE_ORIGIN_TYPES,
  MASTER_CASE_STATUSES
} = require('./contract');

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateMasterCaseContract(document = {}) {
  const errors = [];

  if (!document || typeof document !== 'object') errors.push('MasterCaseContract es obligatorio');
  if (!hasText(document.platformId)) errors.push('platformId es obligatorio');
  if (!MASTER_CASE_TYPES.includes(document.caseType)) errors.push('caseType no es valido');
  if (!MASTER_CASE_ORIGIN_TYPES.includes(document.originType)) errors.push('originType no es valido');
  if (!MASTER_CASE_STATUSES.includes(document.status)) errors.push('status no es valido');
  if (document.originType === 'quotation' && !hasText(document.quotationId)) {
    errors.push('quotationId es obligatorio para expedientes originados en cotizacion');
  }

  return { ok: errors.length === 0, errors };
}

function validateMasterCaseStatusChange(_currentStatus, nextStatus) {
  if (!MASTER_CASE_STATUSES.includes(nextStatus)) {
    return { ok: false, errors: ['status no es valido'] };
  }
  return { ok: true, errors: [] };
}

module.exports = {
  validateMasterCaseContract,
  validateMasterCaseStatusChange
};
