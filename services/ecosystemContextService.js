const { getDashboardData } = require('./dashboardService');

function compactService(service = {}) {
  return {
    id: service.id || null,
    name: service.name || null,
    status: service.status || null,
    http_status: service.http_status ?? null,
    online: service.online === true
  };
}

function compactRepository(repository = {}) {
  return {
    full_name: repository.full_name || null,
    branch: repository.branch || null,
    default_branch: repository.default_branch || null,
    branch_matches_default: repository.branch_matches_default === true,
    healthy: repository.healthy === true,
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

    return {
      available: dashboard?.available === true,
      source: 'ELANKAV Orchestrator',
      status: summary.status || null,
      healthy: summary.healthy === true,
      alerts: Number.isFinite(summary.alerts) ? summary.alerts : null,
      resources: summary.resources || null,
      services: Array.isArray(ecosystem.services)
        ? ecosystem.services.map(compactService)
        : [],
      repositories: Array.isArray(github.repositories)
        ? github.repositories.map(compactRepository)
        : [],
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
  compactService,
  compactRepository,
  compactContainer,
  loadEcosystemContext
};
