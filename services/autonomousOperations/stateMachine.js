'use strict';

const { OPERATION_STATUSES, TERMINAL_STATUSES } = require('./constants');

const TRANSITIONS = Object.freeze({
  RECEIVED: ['RESOLVING', 'REJECTED'],
  RESOLVING: ['PLANNING', 'FAILED', 'REJECTED'],
  PLANNING: ['POLICY_REVIEW', 'FAILED'],
  POLICY_REVIEW: ['EXECUTING', 'WAITING_APPROVAL', 'REJECTED'],
  WAITING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  APPROVED: ['EXECUTING', 'DEPLOYING'],
  EXECUTING: ['VALIDATING', 'FAILED', 'CANCELLED'],
  VALIDATING: ['READY_TO_PUBLISH', 'READY_TO_DEPLOY', 'FAILED'],
  READY_TO_PUBLISH: ['COMPLETED', 'WAITING_APPROVAL'],
  READY_TO_DEPLOY: ['WAITING_APPROVAL', 'DEPLOYING'],
  DEPLOYING: ['VERIFYING', 'FAILED', 'ROLLBACK_REQUIRED'],
  VERIFYING: ['COMPLETED', 'ROLLBACK_REQUIRED'],
  ROLLBACK_REQUIRED: ['ROLLING_BACK'],
  ROLLING_BACK: ['ROLLED_BACK', 'FAILED']
});

function canTransition(currentStatus, nextStatus) {
  if (!Object.values(OPERATION_STATUSES).includes(currentStatus)) return false;
  if (!Object.values(OPERATION_STATUSES).includes(nextStatus)) return false;
  if (TERMINAL_STATUSES.has(currentStatus)) return false;
  return (TRANSITIONS[currentStatus] || []).includes(nextStatus);
}

function assertTransition(currentStatus, nextStatus) {
  if (!canTransition(currentStatus, nextStatus)) {
    const error = new Error(`Transición inválida: ${currentStatus} -> ${nextStatus}`);
    error.code = 'INVALID_OPERATION_TRANSITION';
    throw error;
  }
}

module.exports = { TRANSITIONS, canTransition, assertTransition };
