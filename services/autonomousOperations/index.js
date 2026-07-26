'use strict';

const { AutonomousOperationService } = require('./autonomousOperationService');
const { MemoryOperationRepository } = require('./memoryOperationRepository');
const { OPERATION_STATUSES, TERMINAL_STATUSES, INTENT_TYPES, RISK_LEVELS } = require('./constants');
const { TRANSITIONS, canTransition, assertTransition } = require('./stateMachine');
const { INTENT_RISK, resolveRisk } = require('./riskPolicy');

module.exports = {
  AutonomousOperationService,
  MemoryOperationRepository,
  OPERATION_STATUSES,
  TERMINAL_STATUSES,
  INTENT_TYPES,
  RISK_LEVELS,
  TRANSITIONS,
  canTransition,
  assertTransition,
  INTENT_RISK,
  resolveRisk
};
