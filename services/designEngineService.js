'use strict';

const {
  executeDesignRequest,
  getDesignEngineConfigurationStatus
} = require('../adapters/designEngineAdapter');

function normalizeText(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function buildDesignRequest({
  requestId,
  identityId,
  phone,
  platform,
  channel,
  message,
  projectType = 'CUSTOM_DESIGN_REQUEST',
  environment = null,
  measurements = [],
  measurementStatus = 'MISSING',
  brandAssets = [],
  references = [],
  instructions = []
} = {}) {
  const normalizedMessage = normalizeText(message);

  if (!normalizedMessage) {
    const error = new Error(
      'message es obligatorio para Design Engine'
    );
    error.code = 'DESIGN_MESSAGE_REQUIRED';
    throw error;
  }

  if (!platform) {
    const error = new Error(
      'platform es obligatoria para Design Engine'
    );
    error.code = 'DESIGN_PLATFORM_REQUIRED';
    throw error;
  }

  return Object.freeze({
    requestId: requestId || null,
    actor: Object.freeze({
      source: 'ELAN_IA',
      identityId: identityId || null,
      phone: phone || null
    }),
    platform,
    channel: channel || null,
    projectType,
    message: normalizedMessage,
    measurements: Object.freeze([...measurements]),
    measurementStatus,
    environment,
    brandAssets: Object.freeze([...brandAssets]),
    references: Object.freeze([...references]),
    instructions: Object.freeze([...instructions]),
    directClientConversation: false
  });
}

async function processDesignRequest(input = {}) {
  const request = buildDesignRequest(input);
  const adapterResult = await executeDesignRequest(request);

  return Object.freeze({
    handled: true,
    provider: adapterResult.provider,
    mode: adapterResult.mode,
    connected: adapterResult.connected,
    request,
    result: adapterResult,
    outputText:
      'La solicitud de diseño fue recibida por ELAN IA y está lista para ser procesada por el Design Engine.',
    conversational: false
  });
}

module.exports = {
  buildDesignRequest,
  getDesignEngineConfigurationStatus,
  processDesignRequest
};
