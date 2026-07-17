class MasterCaseRepository {
  constructor({ adapter } = {}) {
    if (!adapter) throw new Error('MasterCaseRepository requiere adapter');
    this.adapter = adapter;
  }

  create(row) {
    return this.adapter.create(row);
  }

  list(filters) {
    return this.adapter.list(filters);
  }

  getById(id) {
    return this.adapter.getById(id);
  }

  getByCaseNumber(caseNumber) {
    if (typeof this.adapter.getByCaseNumber !== 'function') return null;
    return this.adapter.getByCaseNumber(caseNumber);
  }

  getByQuotationId(quotationId) {
    if (typeof this.adapter.getByQuotationId !== 'function') return null;
    return this.adapter.getByQuotationId(quotationId);
  }

  update(id, patch) {
    if (typeof this.adapter.update !== 'function') return null;
    return this.adapter.update(id, patch);
  }

  reserveBaseSequence(input) {
    if (typeof this.adapter.reserveBaseSequence !== 'function') {
      throw new Error('MasterCaseRepository requiere reserveBaseSequence');
    }
    return this.adapter.reserveBaseSequence(input);
  }

  recordAudit(row) {
    if (typeof this.adapter.recordAudit !== 'function') return null;
    return this.adapter.recordAudit(row);
  }
}

module.exports = { MasterCaseRepository };
