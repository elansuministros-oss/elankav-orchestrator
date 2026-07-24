'use strict';

const { randomUUID } = require('node:crypto');
const {
  CONTRACT_VERSION,
  invokeElanAIRuntime
} = require('../adapters/elanAIRuntimeAdapter');
const {
  resolveElanAIRuntimeAccess
} = require('./elanAIRuntimeAccessService');

function normalizeMode(value = process.env.ELAN_AI_RUNTIME_MODE) {
  return String(value || 'off').trim().toLowerCase();
}

function createSkippedObservation(reason) {
  return Object.freeze({
    enabled: false,
    mode: 'off',
    status: 'SKIPPED',
    reason
  });
}

async function observeWithElanAI({
  message,
  context = {},
  metadata = {},
  mode = process.env.ELAN_AI_RUNTIME_MODE,
  invokeRuntime = invokeElanAIRuntime
} = {}) {
  const normalizedMode = normalizeMode(mode);

  if (normalizedMode === 'off') {
    return createSkippedObservation('RUNTIME_MODE_OFF');
  }

  if (!['shadow', 'controlled'].includes(normalizedMode)) {
    return createSkippedObservation('RUNTIME_MODE_UNSUPPORTED');
  }

  const requestId =
    context.requestId ||
    metadata.requestId ||
    randomUUID();
  const ownerMode = context.owner?.isOwner === true;
  const access = resolveElanAIRuntimeAccess({
    context,
    requestedMode: normalizedMode
  });

  const request = {
    version: CONTRACT_VERSION,
    requestId,
    mode: access.runtimeMode,
    channel: context.channel || 'internal',
    message,
    identity: {
      externalUserId: context.externalUserId || null,
      phone: context.owner?.phone || context.externalUserId || null,
      ownerMode
    },
    context: {
      platform: context.platform || null,
      permissions: access.permissions,
      conversationHistory: Array.isArray(metadata.conversationHistory)
        ? metadata.conversationHistory
        : [],
      metadata: {
        source: 'elankav-orchestrator',
        contextVersion: context.version || null
      }
    }
  };

  try {
    const result = await invokeRuntime({ request });

    return Object.freeze({
      enabled: true,
      mode: access.executionMode,
      status: access.toolsAllowed ? 'CONTROLLED' : 'OBSERVED',
      requestId,
      runtimeRequestId: result.runtimeRequestId || null,
      decision: Object.freeze({
        intent: result.decision?.intent || null,
        operator: result.decision?.operator || null,
        allowed: result.decision?.allowed === true,
        cancelled: result.decision?.cancelled === true
      }),
      audit: Object.freeze({
        toolsAllowed: access.toolsAllowed,
        toolsExecuted: result.audit?.toolsExecuted === true,
        toolCalls: Array.isArray(result.audit?.toolCalls)
          ? result.audit.toolCalls
          : []
      }),
      deliverable: false,
      fallback: 'current-message-service'
    });
  } catch (error) {
    console.warn('[ELAN_AI_SHADOW_UNAVAILABLE]', {
      requestId,
      code: error.code || error.name || 'UNKNOWN'
    });

    return Object.freeze({
      enabled: true,
      mode: 'shadow',
      status: 'UNAVAILABLE',
      requestId,
      errorCode: error.code || error.name || 'UNKNOWN',
      deliverable: false,
      fallback: 'current-message-service'
    });
  }
}

module.exports = {
  normalizeMode,
  observeWithElanAI
};
