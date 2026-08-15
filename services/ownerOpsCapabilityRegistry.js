'use strict';

const RISK = Object.freeze({
  READ: 'READ',
  LOW_RISK: 'LOW_RISK',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
  DENIED: 'DENIED'
});

const SERVICES = Object.freeze({
  connect: 'elankav-connect.service',
  orchestrator: 'elankav-orchestrator.service'
});

const REPOSITORIES = Object.freeze({
  connect: '/opt/elankav/connect',
  orchestrator: '/opt/elankav/orchestrator'
});

const CAPABILITIES = Object.freeze({
  'server.summary': Object.freeze({
    id: 'server.summary',
    risk: RISK.READ,
    description: 'Resumen de uptime, memoria, disco y estado de servicios ELANKAV.'
  }),
  'service.status': Object.freeze({
    id: 'service.status',
    risk: RISK.READ,
    description: 'Consulta si un servicio autorizado está activo.'
  }),
  'service.logs': Object.freeze({
    id: 'service.logs',
    risk: RISK.READ,
    description: 'Lee logs recientes de un servicio autorizado.'
  }),
  'git.status': Object.freeze({
    id: 'git.status',
    risk: RISK.READ,
    description: 'Consulta rama, commit, cambios locales y diff stat de un repositorio autorizado.'
  })
});

function getCapability(id) {
  return CAPABILITIES[id] || null;
}

function resolveService(alias) {
  return SERVICES[String(alias || '').toLowerCase()] || null;
}

function resolveRepository(alias) {
  return REPOSITORIES[String(alias || '').toLowerCase()] || null;
}

function listCapabilities() {
  return Object.values(CAPABILITIES);
}

module.exports = {
  CAPABILITIES,
  RISK,
  getCapability,
  listCapabilities,
  resolveRepository,
  resolveService
};
