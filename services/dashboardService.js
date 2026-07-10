const {
  getSystemStatus
} = require('../adapters/systemAdapter');

const {
  getEcosystemStatus
} = require('../adapters/ecosystemAdapter');

const {
  getDockerStatus
} = require('../adapters/dockerAdapter');

const {
  getGithubStatus
} = require('../adapters/githubAdapter');

function normalizeFailure(name, error) {
  return {
    available: false,
    healthy: false,
    source: name,
    error: error?.message || String(error),
    checked_at: new Date().toISOString()
  };
}

function normalizeResult(name, result) {
  if (result.status === 'fulfilled') {
    return result.value;
  }

  return normalizeFailure(name, result.reason);
}

function getDockerHealthy(docker) {
  return Boolean(
    docker?.available === true &&
    Number.isFinite(docker?.total) &&
    Number.isFinite(docker?.running) &&
    docker.running === docker.total
  );
}

function buildAlerts({
  system,
  ecosystem,
  docker,
  github
}) {
  const alerts = [];

  if (!system?.available || !system?.healthy) {
    alerts.push({
      source: 'system',
      level: 'critical',
      message: 'El sistema del Orchestrator presenta una degradación'
    });
  }

  if (!ecosystem?.available) {
    alerts.push({
      source: 'ecosystem',
      level: 'critical',
      message: 'No fue posible consultar el ecosistema'
    });
  } else if (!ecosystem?.healthy) {
    alerts.push({
      source: 'ecosystem',
      level: 'warning',
      message: `${ecosystem.offline || 0} servicio(s) fuera de línea`
    });
  }

  if (!docker?.available) {
    alerts.push({
      source: 'docker',
      level: 'critical',
      message: 'No fue posible consultar Docker'
    });
  } else if (!getDockerHealthy(docker)) {
    alerts.push({
      source: 'docker',
      level: 'warning',
      message: `${docker.stopped || 0} contenedor(es) detenido(s)`
    });
  }

  if (!github?.available) {
    alerts.push({
      source: 'github',
      level: 'critical',
      message: 'No fue posible consultar GitHub'
    });
  } else if (!github?.healthy) {
    alerts.push({
      source: 'github',
      level: 'warning',
      message: `${github.offline || 0} repositorio(s) no saludable(s)`
    });
  }

  return alerts;
}

function buildSummary({
  system,
  ecosystem,
  docker,
  github,
  alerts,
  elapsedMs
}) {
  const systemHealthy =
    system?.available === true &&
    system?.healthy === true;

  const ecosystemHealthy =
    ecosystem?.available === true &&
    ecosystem?.healthy === true;

  const dockerHealthy = getDockerHealthy(docker);

  const githubHealthy =
    github?.available === true &&
    github?.healthy === true;

  const healthy =
    systemHealthy &&
    ecosystemHealthy &&
    dockerHealthy &&
    githubHealthy;

  return {
    healthy,
    status: healthy ? 'OK' : 'DEGRADED',

    sources: {
      total: 4,
      healthy: [
        systemHealthy,
        ecosystemHealthy,
        dockerHealthy,
        githubHealthy
      ].filter(Boolean).length
    },

    services: {
      total: ecosystem?.total ?? 0,
      online: ecosystem?.online ?? 0,
      offline: ecosystem?.offline ?? 0
    },

    containers: {
      total: docker?.total ?? 0,
      running: docker?.running ?? 0,
      stopped: docker?.stopped ?? 0
    },

    repositories: {
      total: github?.total ?? 0,
      healthy: github?.healthy_repositories ?? 0,
      offline: github?.offline ?? 0
    },

    resources: {
      memory_usage_percent:
        system?.memory?.usage_percent ?? null,

      disk_usage_percent:
        system?.disk?.usage_percent ?? null,

      load_average_one_minute:
        system?.cpu?.load_average?.one_minute ?? null
    },

    alerts: alerts.length,
    elapsed_ms: elapsedMs
  };
}

async function getDashboardData() {
  const startedAt = Date.now();

  const names = [
    'system',
    'ecosystem',
    'docker',
    'github'
  ];

  const results = await Promise.allSettled([
    getSystemStatus(),
    getEcosystemStatus(),
    getDockerStatus(),
    getGithubStatus()
  ]);

  const data = {};

  results.forEach((result, index) => {
    const name = names[index];
    data[name] = normalizeResult(name, result);
  });

  const alerts = buildAlerts(data);
  const elapsedMs = Date.now() - startedAt;

  return {
    available: true,
    summary: buildSummary({
      ...data,
      alerts,
      elapsedMs
    }),
    alerts,
    data,
    checked_at: new Date().toISOString()
  };
}

module.exports = {
  getDockerHealthy,
  buildAlerts,
  buildSummary,
  getDashboardData
};
