'use strict';

const { randomUUID } = require('node:crypto');
const {
  CONTRACT_VERSION,
  invokeElanAIRuntime
} = require('../adapters/elanAIRuntimeAdapter');

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

  if (normalizedMode !== 'shadow') {
    return createSkippedObservation('RUNTIME_MODE_NOT_SHADOW');
  }

  const requestId =
    context.requestId ||
    metadata.requestId ||
    randomUUID();
  const ownerMode = context.owner?.isOwner === true;

  const request = {
    version: CONTRACT_VERSION,
    requestId,
    mode: 'shadow',
    channel: context.channel || 'internal',
    message,
    identity: {
      externalUserId: context.externalUserId || null,
      phone: context.owner?.phone || context.externalUserId || null,
      ownerMode
    },
    context: {
      platform: context.platform || null,
      permissions: ownerMode
        ? ['owner:observe']
        : ['customer:observe'],
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
      mode: 'shadow',
      status: 'OBSERVED',
      requestId,
      runtimeRequestId: result.runtimeRequestId || null,
      decision: Object.freeze({
        intent: result.decision?.intent || null,
        operator: result.decision?.operator || null,
        allowed: result.decision?.allowed === true,
        cancelled: result.decision?.cancelled === true
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
