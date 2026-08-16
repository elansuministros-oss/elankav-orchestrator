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
  'production.audit': Object.freeze({
    id: 'production.audit',
    risk: RISK.READ,
    description: 'Auditoría integral de producción: servidor, servicios, Git y presencia de configuración sin revelar secretos.'
  }),
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
  }),
  'service.restart': Object.freeze({
    id: 'service.restart',
    risk: RISK.CONFIRM_REQUIRED,
    description: 'Reinicia un servicio explícitamente autorizado y verifica que vuelva a estado active.'
  }),
  'git.publish-prepared': Object.freeze({
    id: 'git.publish-prepared',
    risk: RISK.CONFIRM_REQUIRED,
    description: 'Publica una rama local preparada y validada, y crea Pull Request sin merge ni deploy.'
  }),
  'repository.deploy': Object.freeze({
    id: 'repository.deploy',
    risk: RISK.CONFIRM_REQUIRED,
    description: 'Actualiza un repositorio autorizado mediante fast-forward a un commit remoto exacto, crea backup y verifica el servicio.'
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
