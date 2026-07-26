'use strict';

class MemoryOperationRepository {
  constructor() {
    this.operations = new Map();
  }

  async create(operation) {
    if (this.operations.has(operation.id)) {
      const error = new Error(`La operación ${operation.id} ya existe`);
      error.code = 'OPERATION_ALREADY_EXISTS';
      throw error;
    }
    this.operations.set(operation.id, structuredClone(operation));
    return structuredClone(operation);
  }

  async findById(operationId) {
    const operation = this.operations.get(operationId);
    return operation ? structuredClone(operation) : null;
  }

  async update(operationId, changes) {
    const current = this.operations.get(operationId);
    if (!current) {
      const error = new Error(`Operación no encontrada: ${operationId}`);
      error.code = 'OPERATION_NOT_FOUND';
      throw error;
    }
    const next = { ...current, ...structuredClone(changes) };
    this.operations.set(operationId, next);
    return structuredClone(next);
  }

  async findActiveByActor(actorId) {
    return [...this.operations.values()]
      .filter(operation => operation.actor?.identityId === actorId)
      .filter(operation => !['COMPLETED', 'FAILED', 'ROLLED_BACK', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(operation.status))
      .sort((a, b) => b.timestamps.updatedAt.localeCompare(a.timestamps.updatedAt))
      .map(structuredClone);
  }
}

module.exports = { MemoryOperationRepository };
