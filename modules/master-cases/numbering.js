const { createMasterCaseContract } = require('./contract');
const { mapMasterCaseContractToRow, toPublicMasterCase } = require('./entities');

const DOCUMENT_PREFIXES = Object.freeze({
  work_order: 'OT',
  purchase_order: 'OC'
});

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function makeError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function isDuplicateError(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.cause?.code || ''} ${error?.cause?.message || ''}`;
  return /23505|duplicate|duplicad|unique/i.test(text);
}

function normalizePlatformId(value) {
  return String(value || 'ELANVISUAL').trim().toUpperCase() || 'ELANVISUAL';
}

function normalizeYear(value) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 1900) return String(parsed);
  return String(new Date().getUTCFullYear());
}

function parseQuotationBaseSequence(quotationNumber = '') {
  const raw = String(quotationNumber || '').trim();
  const match = raw.match(/(?:^|[^0-9])(\d{4})-(\d{1,6})(?:$|[^0-9])/);
  if (!match) {
    throw makeError(
      'DOCUMENT_LINEAGE_QUOTATION_NUMBER_INVALID',
      'No fue posible resolver la secuencia base de la cotizacion persistida'
    );
  }
  return `${match[1]}-${String(Number(match[2])).padStart(6, '0')}`;
}

function formatCaseNumber(baseSequence) {
  if (!hasText(baseSequence)) {
    throw makeError('DOCUMENT_LINEAGE_BASE_SEQUENCE_REQUIRED', 'baseSequence es obligatorio');
  }
  return `ELK-${baseSequence}`;
}

function formatDocumentNumber({ documentType, baseSequence, ordinal = 1, requiresSuffix = false } = {}) {
  const prefix = DOCUMENT_PREFIXES[documentType];
  if (!prefix) throw makeError('DOCUMENT_LINEAGE_TYPE_INVALID', 'documentType no es valido');
  const base = `${prefix}-${baseSequence}`;
  return requiresSuffix ? `${base}-${String(ordinal).padStart(2, '0')}` : base;
}

function toPublicCase(row = {}) {
  return row.caseId ? row : toPublicMasterCase(row);
}

function resolveLineageOriginId(source = {}) {
  return source.sourceId || source.quotationId || source.workOrderId || source.projectId || source.purchaseRequestId || '';
}

function buildLineage({ masterCase, source = {}, quotation = null } = {}) {
  const publicCase = toPublicCase(masterCase);
  const originType = source.type || (publicCase.originType === 'quotation' ? 'quotation' : 'manual');
  return {
    caseId: publicCase.caseId,
    caseNumber: publicCase.caseNumber,
    baseSequence: publicCase.baseSequence,
    originType,
    originId: resolveLineageOriginId(source) || publicCase.originId || '',
    quotationId: quotation?.id || publicCase.quotationId || source.quotationId || '',
    quotationNumber: quotation?.quotation_number || publicCase.quotationNumber || ''
  };
}

class DocumentLineageNumberService {
  constructor({
    masterCaseRepository,
    workOrderRepository,
    purchaseOrderRepository,
    quotationRepository,
    maxCreateAttempts = 3,
    now = () => new Date()
  } = {}) {
    if (!masterCaseRepository) throw new Error('DocumentLineageNumberService requiere masterCaseRepository');
    this.masterCaseRepository = masterCaseRepository;
    this.workOrderRepository = workOrderRepository;
    this.purchaseOrderRepository = purchaseOrderRepository;
    this.quotationRepository = quotationRepository;
    this.maxCreateAttempts = maxCreateAttempts;
    this.now = now;
  }

  async assignWorkOrderLineage(contract = {}, actor = {}) {
    const source = contract.source || { type: 'manual' };
    const platformId = normalizePlatformId(contract.workOrder?.platformId || actor.platformId);
    const masterCase = await this.resolveOrCreateCase({
      source,
      lineage: contract.lineage,
      platformId,
      actor,
      manualOriginType: 'manual_work_order',
      manualCaseType: 'internal_work'
    });
    const sameTypeCount = await this.countByCase(this.workOrderRepository, masterCase.caseId || masterCase.id);
    const documentNumber = formatDocumentNumber({
      documentType: 'work_order',
      baseSequence: masterCase.baseSequence || masterCase.base_sequence,
      ordinal: sameTypeCount + 1,
      requiresSuffix: sameTypeCount > 0
    });

    return {
      documentNumber,
      lineage: buildLineage({ masterCase, source, quotation: masterCase.__quotation || null })
    };
  }

  async assignPurchaseOrderLineage(contract = {}, actor = {}) {
    const source = contract.source || { type: 'manual' };
    const platformId = normalizePlatformId(contract.purchaseOrder?.platformId || actor.platformId);
    const masterCase = await this.resolveOrCreateCase({
      source,
      lineage: contract.lineage,
      platformId,
      actor,
      manualOriginType: 'manual_purchase',
      manualCaseType: 'internal_purchase'
    });
    const sameTypeCount = await this.countByCase(this.purchaseOrderRepository, masterCase.caseId || masterCase.id);
    const attachedToExistingFlow = source.type !== 'manual' || hasText(contract.lineage?.caseId);
    const documentNumber = formatDocumentNumber({
      documentType: 'purchase_order',
      baseSequence: masterCase.baseSequence || masterCase.base_sequence,
      ordinal: sameTypeCount + 1,
      requiresSuffix: attachedToExistingFlow || sameTypeCount > 0
    });

    return {
      documentNumber,
      lineage: buildLineage({ masterCase, source, quotation: masterCase.__quotation || null })
    };
  }

  async resolveOrCreateCase({ source = {}, lineage = {}, platformId, actor = {}, manualOriginType, manualCaseType } = {}) {
    if (hasText(lineage.caseId)) {
      const masterCase = await this.masterCaseRepository.getById(lineage.caseId);
      if (!masterCase) {
        throw makeError('DOCUMENT_LINEAGE_CASE_NOT_FOUND', 'El expediente maestro indicado no existe');
      }
      return toPublicCase(masterCase);
    }

    if (source.type === 'quotation') {
      return this.resolveQuotationCase({ source, platformId, actor });
    }

    if (source.type === 'workOrder') {
      return this.resolveWorkOrderCase(source);
    }

    return this.createManualCase({ source, platformId, actor, manualOriginType, manualCaseType });
  }

  async resolveQuotationCase({ source = {}, platformId, actor = {} } = {}) {
    const quotationId = source.quotationId || source.sourceId || '';
    if (!hasText(quotationId)) {
      throw makeError('DOCUMENT_LINEAGE_QUOTATION_REQUIRED', 'quotationId es obligatorio para usar una cotizacion como origen');
    }
    if (!this.quotationRepository || typeof this.quotationRepository.getQuotationById !== 'function') {
      throw makeError('DOCUMENT_LINEAGE_QUOTATION_REPOSITORY_MISSING', 'No hay repositorio de cotizaciones configurado');
    }

    const quotation = await this.quotationRepository.getQuotationById(quotationId);
    if (!quotation) {
      throw makeError('DOCUMENT_LINEAGE_QUOTATION_NOT_FOUND', 'La cotizacion persistida no existe');
    }
    if (!hasText(quotation.quotation_number)) {
      throw makeError('DOCUMENT_LINEAGE_QUOTATION_NUMBER_MISSING', 'La cotizacion persistida no tiene numero oficial');
    }

    const existing = await this.masterCaseRepository.getByQuotationId(quotationId);
    if (existing) {
      return {
        ...toPublicCase(existing),
        __quotation: quotation
      };
    }

    const baseSequence = parseQuotationBaseSequence(quotation.quotation_number);
    const caseNumber = formatCaseNumber(baseSequence);
    const document = createMasterCaseContract({
      caseNumber,
      platformId,
      caseType: 'commercial',
      originType: 'quotation',
      originId: quotationId,
      quotationId,
      quotationNumber: quotation.quotation_number,
      baseSequence,
      status: 'open',
      createdBy: actor.userId || ''
    });

    try {
      const created = await this.masterCaseRepository.create(mapMasterCaseContractToRow(document));
      return {
        ...toPublicCase(created),
        __quotation: quotation
      };
    } catch (error) {
      if (!isDuplicateError(error)) throw error;
      const byQuotation = await this.masterCaseRepository.getByQuotationId(quotationId);
      const byNumber = byQuotation || await this.masterCaseRepository.getByCaseNumber(caseNumber);
      if (byNumber) {
        return {
          ...toPublicCase(byNumber),
          __quotation: quotation
        };
      }
      throw makeError('DOCUMENT_LINEAGE_CASE_COLLISION', 'No fue posible reutilizar el expediente maestro duplicado');
    }
  }

  async resolveWorkOrderCase(source = {}) {
    const workOrderId = source.workOrderId || source.sourceId || '';
    if (!hasText(workOrderId)) {
      throw makeError('DOCUMENT_LINEAGE_WORK_ORDER_REQUIRED', 'workOrderId es obligatorio para usar una orden de trabajo como origen');
    }
    if (!this.workOrderRepository || typeof this.workOrderRepository.getById !== 'function') {
      throw makeError('DOCUMENT_LINEAGE_WORK_ORDER_REPOSITORY_MISSING', 'No hay repositorio de ordenes de trabajo configurado');
    }
    const workOrder = await this.workOrderRepository.getById(workOrderId);
    if (!workOrder) {
      throw makeError('DOCUMENT_LINEAGE_WORK_ORDER_NOT_FOUND', 'La orden de trabajo persistida no existe');
    }
    const caseId = workOrder.case_id || workOrder.lineage?.caseId || workOrder.lineage?.case_id || '';
    if (!hasText(caseId)) {
      throw makeError('DOCUMENT_LINEAGE_WORK_ORDER_CASE_MISSING', 'La orden de trabajo no tiene expediente maestro');
    }
    const masterCase = await this.masterCaseRepository.getById(caseId);
    if (!masterCase) {
      throw makeError('DOCUMENT_LINEAGE_CASE_NOT_FOUND', 'El expediente maestro de la orden de trabajo no existe');
    }
    return toPublicCase(masterCase);
  }

  async createManualCase({ source = {}, platformId, actor = {}, manualOriginType, manualCaseType } = {}) {
    const year = normalizeYear(this.now().getUTCFullYear());
    for (let attempt = 0; attempt < this.maxCreateAttempts; attempt += 1) {
      const baseSequence = await this.masterCaseRepository.reserveBaseSequence({ year });
      const caseNumber = formatCaseNumber(baseSequence);
      const document = createMasterCaseContract({
        caseNumber,
        platformId,
        caseType: manualCaseType,
        originType: manualOriginType,
        originId: resolveLineageOriginId(source),
        baseSequence,
        status: 'open',
        createdBy: actor.userId || ''
      });

      try {
        return toPublicCase(await this.masterCaseRepository.create(mapMasterCaseContractToRow(document)));
      } catch (error) {
        if (!isDuplicateError(error) || attempt + 1 >= this.maxCreateAttempts) {
          throw makeError('DOCUMENT_LINEAGE_CORRELATIVE_COLLISION', 'No fue posible reservar un correlativo maestro unico');
        }
      }
    }
    throw makeError('DOCUMENT_LINEAGE_CORRELATIVE_COLLISION', 'No fue posible reservar un correlativo maestro unico');
  }

  async countByCase(repository, caseId) {
    if (!repository || typeof repository.countByCaseId !== 'function' || !caseId) return 0;
    const count = await repository.countByCaseId(caseId);
    return Number.isFinite(Number(count)) ? Number(count) : 0;
  }

  async recordAudit({
    documentType,
    documentId,
    caseId,
    action,
    previousStatus,
    newStatus,
    actor = {},
    platformId,
    comment
  } = {}) {
    if (!this.masterCaseRepository || typeof this.masterCaseRepository.recordAudit !== 'function') return null;
    return this.masterCaseRepository.recordAudit({
      document_type: documentType,
      document_id: documentId || null,
      case_id: caseId || null,
      platform_id: platformId || actor.platformId || null,
      actor_id: actor.userId || null,
      actor_type: actor.type || 'user',
      action,
      previous_status: previousStatus || null,
      new_status: newStatus || null,
      comment: comment || null,
      created_at: new Date().toISOString()
    });
  }
}

module.exports = {
  DocumentLineageNumberService,
  parseQuotationBaseSequence,
  formatCaseNumber,
  formatDocumentNumber
};
