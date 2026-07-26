'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AutonomousOperationService,
  MemoryOperationRepository,
  OPERATION_STATUSES,
  INTENT_TYPES,
  canTransition,
  resolveRisk
} = require('../services/autonomousOperations');

function createService() {
  let sequence = 0;
  return new AutonomousOperationService({
    repository: new MemoryOperationRepository(),
    clock: () => new Date('2026-07-26T12:00:00.000Z'),
    idFactory: () => `test-${++sequence}`
  });
}

test('crea una operación autónoma para Owner verificado', async () => {
  const service = createService();
  const operation = await service.createOperation({
    originalMessage: 'Revisá CONNECT',
    actor: { type: 'OWNER', identityId: 'owner-1', channel: 'whatsapp', verified: true },
    intent: { type: INTENT_TYPES.DIAGNOSE, objective: 'Diagnosticar CONNECT' },
    target: { workspaceId: 'CONNECT', environment: 'development' }
  });

  assert.equal(operation.id, 'op_test-1');
  assert.equal(operation.status, OPERATION_STATUSES.RECEIVED);
  assert.equal(operation.risk.level, 'R0');
  assert.equal(operation.risk.approvalRequired, false);
});

test('rechaza una operación sin Owner verificado', async () => {
  const service = createService();
  await assert.rejects(
    service.createOperation({
      originalMessage: 'Modificá CONNECT',
      actor: { type: 'CUSTOMER', identityId: 'customer-1', verified: true },
      intent: { type: INTENT_TYPES.CODE_CHANGE, objective: 'Modificar CONNECT' }
    }),
    error => error.code === 'OWNER_REQUIRED'
  );
});

test('aplica transiciones válidas y rechaza transiciones inválidas', async () => {
  const service = createService();
  const operation = await service.createOperation({
    originalMessage: 'Revisá CONNECT',
    actor: { type: 'OWNER', identityId: 'owner-1', verified: true },
    intent: { type: INTENT_TYPES.DIAGNOSE, objective: 'Diagnosticar CONNECT' }
  });

  const resolving = await service.transition(operation.id, OPERATION_STATUSES.RESOLVING);
  assert.equal(resolving.status, OPERATION_STATUSES.RESOLVING);
  await assert.rejects(
    service.transition(operation.id, OPERATION_STATUSES.COMPLETED),
    error => error.code === 'INVALID_OPERATION_TRANSITION'
  );
});

test('clasifica deploy como R3 y exige aprobación', () => {
  assert.deepEqual(
    resolveRisk({ intentType: INTENT_TYPES.DEPLOY }),
    { level: 'R3', approvalRequired: true }
  );
  assert.equal(canTransition('WAITING_APPROVAL', 'APPROVED'), true);
  assert.equal(canTransition('COMPLETED', 'EXECUTING'), false);
});
