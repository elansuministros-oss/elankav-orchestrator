const { getDashboardData } = require('./dashboardService');
const {
  loadPlatformKnowledgeSafely,
  normalizePlatform
} = require('./connectPlatformKnowledgeService');

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

function resolveOwnerKnowledgePlatform(value) {
  return normalizePlatform(
    value ||
    process.env.WAHA_DEFAULT_PLATFORM ||
    process.env.ELAN_AI_DEFAULT_PLATFORM ||
    'ELANVISUAL'
  );
}

function buildApprovedCommercialKnowledgeService(knowledge, resolvedPlatform) {
  if (knowledge?.available !== true || !knowledge?.payload) return null;

  return {
    id: `approved-commercial-catalogs-${resolvedPlatform}`,
    name: `Catálogos comerciales aprobados de ${String(resolvedPlatform || '').toUpperCase()}: ${JSON.stringify(knowledge.payload)}`,
    status: 'ACTIVE',
    http_status: 200,
    online: true
  };
}

async function loadEcosystemContext({
  getDashboardDataImpl = getDashboardData,
  loadKnowledgeImpl = loadPlatformKnowledgeSafely,
  platform,
  query = ''
} = {}) {
  try {
    const resolvedPlatform = resolveOwnerKnowledgePlatform(platform);
    const [dashboard, approvedCommercialKnowledge] = await Promise.all([
      getDashboardDataImpl(),
      Promise.resolve()
        .then(() => loadKnowledgeImpl({
          platform: resolvedPlatform,
          query
        }))
        .catch(() => null)
    ]);
    const summary = dashboard?.summary || {};
    const ecosystem = dashboard?.data?.ecosystem || {};
    const github = dashboard?.data?.github || {};
    const docker = dashboard?.data?.docker || {};
    const services = Array.isArray(ecosystem.services)
      ? ecosystem.services.map(compactService)
      : [];
    const approvedCatalogService = buildApprovedCommercialKnowledgeService(
      approvedCommercialKnowledge,
      resolvedPlatform
    );

    if (approvedCatalogService) services.push(approvedCatalogService);

    return {
      available: dashboard?.available === true,
      source: 'ELANKAV Orchestrator',
      status: summary.status || null,
      healthy: summary.healthy === true,
      alerts: Number.isFinite(summary.alerts) ? summary.alerts : null,
      resources: summary.resources || null,
      services,
      repositories: Array.isArray(github.repositories)
        ? github.repositories.map(compactRepository)
        : [],
      githubAuthenticated: github.authenticated === true,
      containers: Array.isArray(docker.containers)
        ? docker.containers.map(compactContainer)
        : [],
      approvedCommercialKnowledge:
        approvedCommercialKnowledge?.available === true
          ? {
              available: true,
              source: approvedCommercialKnowledge.source || 'ELANKAV_CONNECT',
              policy: approvedCommercialKnowledge.policy || 'approved-commercial-catalogs-only',
              platformId: approvedCommercialKnowledge.platformId || resolvedPlatform,
              payload: approvedCommercialKnowledge.payload || null
            }
          : null,
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
  resolveOwnerKnowledgePlatform,
  buildApprovedCommercialKnowledgeService,
  loadEcosystemContext
};
