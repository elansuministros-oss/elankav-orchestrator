'use strict';

const { randomUUID } = require('node:crypto');
const { OPERATION_STATUSES, INTENT_TYPES } = require('./constants');
const { assertTransition } = require('./stateMachine');
const { resolveRisk } = require('./riskPolicy');
const { MemoryOperationRepository } = require('./memoryOperationRepository');

function normalizeActor(actor = {}) {
  if (actor.type !== 'OWNER' || actor.verified !== true || !actor.identityId) {
    const error = new Error('La operación autónoma requiere un Owner verificado');
    error.code = 'OWNER_REQUIRED';
    throw error;
  }
  return {
    type: 'OWNER',
    identityId: String(actor.identityId),
    channel: String(actor.channel || 'unknown'),
    verified: true
  };
}

function normalizeIntent(intent = {}) {
  if (!Object.values(INTENT_TYPES).includes(intent.type)) {
    const error = new Error('Tipo de intención autónoma inválido');
    error.code = 'INVALID_OPERATION_INTENT';
    throw error;
  }
  return {
    type: intent.type,
    objective: String(intent.objective || '').trim(),
    requestedActions: Array.isArray(intent.requestedActions) ? [...intent.requestedActions] : [],
    deployRequested: intent.deployRequested === true,
    mergeRequested: intent.mergeRequested === true
  };
}

class AutonomousOperationService {
  constructor({ repository = new MemoryOperationRepository(), clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async createOperation({ requestId = null, originalMessage, actor, source = {}, intent, target = {} }) {
    const now = this.clock().toISOString();
    const normalizedIntent = normalizeIntent(intent);
    const risk = resolveRisk({
      intentType: normalizedIntent.type,
      productionImpact: target.environment === 'production' || normalizedIntent.deployRequested,
      destructive: target.destructive === true
    });
    const operation = {
      id: `op_${this.idFactory()}`,
      version: 'VSC-003A',
      requestId,
      originalMessage: String(originalMessage || '').trim(),
      actor: normalizeActor(actor),
      source: structuredClone(source),
      intent: normalizedIntent,
      target: structuredClone(target),
      plan: null,
      risk,
      status: OPERATION_STATUSES.RECEIVED,
      approvals: [],
      actionResults: [],
      validations: [],
      evidence: [],
      failure: null,
      rollback: null,
      timestamps: { createdAt: now, updatedAt: now, completedAt: null }
    };
    return this.repository.create(operation);
  }

  async transition(operationId, nextStatus, changes = {}) {
    const operation = await this.repository.findById(operationId);
    if (!operation) {
      const error = new Error(`Operación no encontrada: ${operationId}`);
      error.code = 'OPERATION_NOT_FOUND';
      throw error;
    }
    assertTransition(operation.status, nextStatus);
    const now = this.clock().toISOString();
    const completedAt = ['COMPLETED', 'FAILED', 'ROLLED_BACK', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(nextStatus)
      ? now
      : operation.timestamps.completedAt;
    return this.repository.update(operationId, {
      ...structuredClone(changes),
      status: nextStatus,
      timestamps: { ...operation.timestamps, updatedAt: now, completedAt }
    });
  }
}

module.exports = { AutonomousOperationService, normalizeActor, normalizeIntent };
