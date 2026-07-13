'use strict';

const DESIGN_ENGINE_PROVIDER = 'ELANKAV Design Engine';
const DESIGN_ENGINE_VERSION = '0.1.0';

function getDesignEngineConfigurationStatus() {
  return Object.freeze({
    available: true,
    configured: true,
    connected: false,
    provider: DESIGN_ENGINE_PROVIDER,
    version: DESIGN_ENGINE_VERSION,
    mode: 'stub',
    externalExecutionEnabled: false
  });
}

async function executeDesignRequest(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    const error = new TypeError('Design Engine requiere una solicitud válida');
    error.code = 'DESIGN_REQUEST_INVALID';
    throw error;
  }

  if (request.actor?.source !== 'ELAN_IA') {
    const error = new Error('La entrada debe provenir de ELAN IA');
    error.code = 'DESIGN_ENTRY_SOURCE_INVALID';
    throw error;
  }

  return Object.freeze({
    status: 'STUB_ACCEPTED',
    provider: DESIGN_ENGINE_PROVIDER,
    version: DESIGN_ENGINE_VERSION,
    mode: 'stub',
    connected: false,
    conversational: false,
    requestId: request.requestId || null,
    platform: request.platform || null,
    result: null,
    warnings: Object.freeze([
      'La ejecución real del Design Engine todavía no está habilitada.'
    ])
  });
}

module.exports = {
  DESIGN_ENGINE_PROVIDER,
  DESIGN_ENGINE_VERSION,
  executeDesignRequest,
  getDesignEngineConfigurationStatus
};
