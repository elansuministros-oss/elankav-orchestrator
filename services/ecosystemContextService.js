'use strict';

const { getDashboardData } = require('./dashboardService');

const COMPONENT_GOVERNANCE = Object.freeze({
  'elankav-connect': Object.freeze({
    lifecycle: 'ACTIVE',
    role: 'COMMERCIAL_CORE',
    officialName: 'ELANKAV CONNECT'
  }),
  'elankav-core': Object.freeze({
    lifecycle: 'RETIRED',
    role: 'LEGACY',
    officialName: 'ELANKAV Core'
  })
});

function normalizeComponentId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^elansuministros-oss\//, '');
}

function governanceFor(value) {
  return COMPONENT_GOVERNANCE[normalizeComponentId(value)] || null;
}

function isOperationalComponent(value) {
  return governanceFor(value)?.lifecycle !== 'RETIRED';
}

function compactService(service = {}) {
  const governance = governanceFor(service.id || service.name);
  return {
    id: service.id || null,
    name: governance?.officialName || service.name || null,
    status: service.status || null,
    http_status: service.http_status ?? null,
    online: service.online === true,
    lifecycle: governance?.lifecycle || 'ACTIVE',
    role: governance?.role || null
  };
}

function compactRepository(repository = {}) {
  const governance = governanceFor(repository.full_name);
  return {
    full_name: repository.full_name || null,
    branch: repository.branch || null,
    default_branch: repository.default_branch || null,
    branch_matches_default: repository.branch_matches_default === true,
    healthy: repository.healthy === true,
    lifecycle: governance?.lifecycle || 'ACTIVE',
    role: governance?.role || null,
    last_commit: repository.last_commit
      ? {
          short_sha: repository.last_commit.short_sha || null,
          message: repository.last_commit.message || null,
          date: repository.last_commit.date || null
        }
      : null
  };
}

function compactContainer(container = {}) {
  return {
    name: container.name || null,
    running: container.running === true,
    status: container.status || null
  };
}

async function loadEcosystemContext({
  getDashboardDataImpl = getDashboardData
} = {}) {
  try {
    const dashboard = await getDashboardDataImpl();
    const summary = dashboard?.summary || {};
    const ecosystem = dashboard?.data?.ecosystem || {};
    const github = dashboard?.data?.github || {};
    const docker = dashboard?.data?.docker || {};
    const services = Array.isArray(ecosystem.services)
      ? ecosystem.services
          .filter(service => isOperationalComponent(service?.id || service?.name))
          .map(compactService)
      : [];
    const repositories = Array.isArray(github.repositories)
      ? github.repositories
          .filter(repository => isOperationalComponent(repository?.full_name))
          .map(compactRepository)
      : [];

    return {
      available: dashboard?.available === true,
      source: 'ELANKAV Orchestrator',
      status: summary.status || null,
      healthy: summary.healthy === true,
      alerts: Number.isFinite(summary.alerts) ? summary.alerts : null,
      resources: summary.resources || null,
      architecture: {
        orchestratorRole: 'COORDINATION_ENGINE',
        commercialCore: {
          id: 'elankav-connect',
          name: 'ELANKAV CONNECT',
          lifecycle: 'ACTIVE',
          official: true
        }
      },
      services,
      repositories,
      retiredComponents: [
        {
          id: 'elankav-core',
          name: 'ELANKAV Core',
          lifecycle: 'RETIRED',
          includedInOperationalContext: false
        }
      ],
      githubAuthenticated: github.authenticated === true,
      containers: Array.isArray(docker.containers)
        ? docker.containers.map(compactContainer)
        : [],
      checkedAt: dashboard?.checked_at || new Date().toISOString()
    };
  } catch (error) {
    return {
      available: false,
      source: 'ELANKAV Orchestrator',
      status: 'ERROR',
      healthy: false,
      error: error?.message || String(error),
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  COMPONENT_GOVERNANCE,
  normalizeComponentId,
  governanceFor,
  isOperationalComponent,
  compactService,
  compactRepository,
  compactContainer,
  loadEcosystemContext
};