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
  instructions = [],
  materials = [],
  lighting = null
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

  const normalizedInstructions = [
    normalizedMessage,
    ...instructions
  ].filter(Boolean);

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
    materials: Object.freeze([...materials]),
    lighting,
    instructions: Object.freeze(normalizedInstructions),
    directClientConversation: false
  });
}

async function processDesignRequest(input = {}, options = {}) {
  const request = buildDesignRequest(input);
  const adapterResult = await executeDesignRequest(
    request,
    options
  );
  const designResult = adapterResult.result;
  const processed =
    adapterResult.connected === true &&
    designResult?.status === 'PROCESSED' &&
    designResult?.elanIaResult?.clientReady === true &&
    Array.isArray(designResult?.assets) &&
    designResult.assets.length === 1;

  const outputText = processed
    ? 'Preparé una propuesta visual para tu proyecto.'
    : adapterResult.mode === 'stub'
      ? 'La solicitud de diseño fue recibida, pero el Design Engine no está configurado para generar la imagen.'
      : designResult?.status === 'NEEDS_INFORMATION'
        ? 'Necesito información adicional antes de generar la propuesta visual.'
        : 'No fue posible completar la propuesta visual.';

  return Object.freeze({
    handled: true,
    provider: adapterResult.provider,
    mode: adapterResult.mode,
    connected: adapterResult.connected,
    request,
    result: adapterResult,
    designResult: designResult || null,
    processed,
    outputText,
    conversational: false
  });
}

module.exports = {
  buildDesignRequest,
  getDesignEngineConfigurationStatus,
  processDesignRequest
};
