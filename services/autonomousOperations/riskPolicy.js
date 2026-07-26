'use strict';

const { RISK_LEVELS, INTENT_TYPES } = require('./constants');

const INTENT_RISK = Object.freeze({
  [INTENT_TYPES.INSPECT]: RISK_LEVELS.R0,
  [INTENT_TYPES.DIAGNOSE]: RISK_LEVELS.R0,
  [INTENT_TYPES.TEST]: RISK_LEVELS.R0,
  [INTENT_TYPES.BUILD]: RISK_LEVELS.R0,
  [INTENT_TYPES.CODE_CHANGE]: RISK_LEVELS.R1,
  [INTENT_TYPES.REFACTOR]: RISK_LEVELS.R1,
  [INTENT_TYPES.DEPENDENCY_UPDATE]: RISK_LEVELS.R1,
  [INTENT_TYPES.GIT_OPERATION]: RISK_LEVELS.R2,
  [INTENT_TYPES.PULL_REQUEST]: RISK_LEVELS.R2,
  [INTENT_TYPES.DEPLOY]: RISK_LEVELS.R3,
  [INTENT_TYPES.ROLLBACK]: RISK_LEVELS.R3,
  [INTENT_TYPES.INFRASTRUCTURE]: RISK_LEVELS.R3,
  [INTENT_TYPES.DATABASE_CHANGE]: RISK_LEVELS.R4
});

function resolveRisk({ intentType, productionImpact = false, destructive = false } = {}) {
  if (destructive) return { level: RISK_LEVELS.R4, approvalRequired: true };
  if (productionImpact) return { level: RISK_LEVELS.R3, approvalRequired: true };
  const level = INTENT_RISK[intentType] || RISK_LEVELS.R4;
  return {
    level,
    approvalRequired: [RISK_LEVELS.R3, RISK_LEVELS.R4].includes(level)
  };
}

module.exports = { INTENT_RISK, resolveRisk };
