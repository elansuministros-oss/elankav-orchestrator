'use strict';

function requireFunction(adapter, name) {
  if (!adapter || typeof adapter[name] !== 'function') {
    const error = new Error(`COMMERCIAL_PERSISTENCE_${name.toUpperCase()}_REQUIRED`);
    error.code = 'COMMERCIAL_PERSISTENCE_PORT_INVALID';
    throw error;
  }
}

function validateCommercialPersistencePort(adapter) {
  [
    'getConversationControl',
    'saveConversationControl',
    'createFollowUp',
    'recordCommercialObservation'
  ].forEach(name => requireFunction(adapter, name));
  return adapter;
}

module.exports = {
  validateCommercialPersistencePort
};
