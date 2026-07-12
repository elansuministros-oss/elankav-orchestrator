'use strict';

const REGISTRY_VERSION = '1.1.0';

const services = Object.freeze([
  {
    id: 'github',
    name: 'GitHub',
    state: 'INTEGRATED',
    category: 'source-control',
    permissions: ['github.read'],
    capabilities: { read: true, write: false, execute: false },
    access: 'orchestrator-only',
    notes: 'Consulta de repositorios y estado mediante Adapter y Service.'
  },
  {
    id: 'docker',
    name: 'Docker',
    state: 'INTEGRATED',
    category: 'infrastructure',
    permissions: ['docker.read'],
    capabilities: { read: true, write: false, execute: false },
    access: 'orchestrator-only',
    notes: 'Consulta de contenedores. Escritura administrativa no habilitada por SRV-001A.'
  },
  {
    id: 'waha',
    name: 'WAHA',
    state: 'INTEGRATED',
    category: 'channel',
    permissions: ['waha.read'],
    capabilities: { read: true, write: false, execute: false },
    access: 'orchestrator-only',
    notes: 'Estado del canal WhatsApp disponible mediante Orchestrator.'
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    state: 'INTEGRATED',
    category: 'observability',
    permissions: ['dashboard.read'],
    capabilities: { read: true, write: false, execute: false },
    access: 'orchestrator-only',
    notes: 'Resumen ejecutivo consolidado del ecosistema.'
  },
  {
    id: 'health',
    name: 'Health',
    state: 'INTEGRATED',
    category: 'observability',
    permissions: ['health.read'],
    capabilities: { read: true, write: false, execute: false },
    access: 'orchestrator-only',
    notes: 'Estado vivo del Orchestrator y servicios conectados.'
  },
  {
    id: 'crm',
    name: 'CRM',
    state: 'REGISTERED',
    category: 'business',
    permissions: ['crm.read'],
    capabilities: { read: false, write: false, execute: false },
    access: 'pending-adapter',
    notes: 'Registrado oficialmente; requiere contrato directo del Orchestrator para considerarse integrado.'
  },
  {
    id: 'qa',
    name: 'QA',
    state: 'REGISTERED',
    category: 'quality',
    permissions: ['qa.read', 'qa.execute'],
    capabilities: { read: false, write: false, execute: false },
    access: 'pending-service',
    notes: 'Registrado. La ejecución controlada por Job se habilitará en una fase posterior.'
  },
  {
    id: 'jobs',
    name: 'Jobs',
    state: 'INTEGRATED',
    category: 'operations',
    permissions: ['jobs.read', 'jobs.create'],
    capabilities: { read: true, write: true, execute: true },
    access: 'orchestrator-only',
    notes: 'Job Engine existente. Sus operaciones conservan sus controles actuales.'
  },
  {
    id: 'documentation',
    name: 'Documentación',
    state: 'INTEGRATED',
    category: 'knowledge',
    permissions: ['documentation.read', 'documentation.write'],
    capabilities: { read: true, write: false, execute: false },
    access: 'orchestrator-only',
    notes: 'KB-001A habilita lectura interna segura y registro de impacto. La edición Markdown permanece deshabilitada.'
  },
  {
    id: 'vscode-web',
    name: 'VS Code Web',
    state: 'INTEGRATED',
    category: 'development',
    permissions: ['vscode.workspaces.read'],
    capabilities: { read: true, write: false, execute: false },
    access: 'owner-session',
    notes: 'Acceso mediado por Orchestrator; workspace oficial permanece en modo lectura.'
  }
]);

function cloneService(service) {
  return {
    ...service,
    permissions: [...service.permissions],
    capabilities: { ...service.capabilities }
  };
}

function listAuthorizedServices() {
  return services.map(cloneService);
}

function getAuthorizedService(serviceId) {
  const normalized = String(serviceId || '').trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const service = services.find(item => item.id === normalized);
  return service ? cloneService(service) : null;
}

function getServiceRegistrySnapshot() {
  const registeredServices = listAuthorizedServices();

  return {
    registry: 'ELANKAV Authorized Services',
    version: REGISTRY_VERSION,
    mode: 'read-only',
    count: registeredServices.length,
    integrated: registeredServices.filter(item => item.state === 'INTEGRATED').length,
    registered: registeredServices.filter(item => item.state === 'REGISTERED').length,
    services: registeredServices
  };
}

module.exports = {
  REGISTRY_VERSION,
  getAuthorizedService,
  getServiceRegistrySnapshot,
  listAuthorizedServices
};
