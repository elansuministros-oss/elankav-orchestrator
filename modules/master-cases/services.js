const { createMasterCaseContract } = require('./contract');
const { mapMasterCaseContractToRow, toPublicMasterCase } = require('./entities');
const {
  validateMasterCaseContract,
  validateMasterCaseStatusChange
} = require('./validators');

class MasterCaseService {
  constructor({ repository } = {}) {
    if (!repository) throw new Error('MasterCaseService requiere repository');
    this.repository = repository;
  }

  async create(input = {}, actor = {}) {
    const contract = createMasterCaseContract({
      ...input,
      createdBy: actor.userId || input.createdBy || ''
    });
    const validation = validateMasterCaseContract(contract);
    if (!validation.ok) {
      const error = new Error(`Expediente maestro invalido: ${validation.errors.join('; ')}`);
      error.code = 'MASTER_CASE_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }
    const created = await this.repository.create(mapMasterCaseContractToRow(contract));
    return toPublicMasterCase(created);
  }

  async list(filters = {}) {
    const rows = await this.repository.list(filters);
    return rows.map(toPublicMasterCase);
  }

  async getById(id) {
    const row = await this.repository.getById(id);
    return row ? toPublicMasterCase(row) : null;
  }

  async changeStatus(id, status, actor = {}) {
    const current = await this.repository.getById(id);
    if (!current) return null;
    const validation = validateMasterCaseStatusChange(current.status, status);
    if (!validation.ok) {
      const error = new Error(`Cambio de estado invalido: ${validation.errors.join('; ')}`);
      error.code = 'MASTER_CASE_STATUS_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }
    const updated = await this.repository.update(id, {
      status,
      updated_by: actor.userId || null
    });
    return toPublicMasterCase(updated);
  }
}

module.exports = { MasterCaseService };
