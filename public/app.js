const elements = {
  globalStatus: document.getElementById('global-status'),

  ecosystemTotal: document.getElementById('ecosystem-total'),
  ecosystemOnline: document.getElementById('ecosystem-online'),
  ecosystemOffline: document.getElementById('ecosystem-offline'),
  ecosystemChecked: document.getElementById('ecosystem-checked'),
  ecosystemGrid: document.getElementById('ecosystem-grid'),

  dockerTotal: document.getElementById('docker-total'),
  dockerRunning: document.getElementById('docker-running'),
  dockerStopped: document.getElementById('docker-stopped'),
  dockerChecked: document.getElementById('docker-checked'),
  dockerGrid: document.getElementById('docker-grid')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderRow(label, value) {
  return `
    <div class="data-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || 'No disponible')}</strong>
    </div>
  `;
}

function renderService(service) {
  const stateClass = service.online ? '' : ' offline';
  const stateLabel = service.online ? 'ONLINE' : 'OFFLINE';

  return `
    <article class="service-card${stateClass}">
      <span class="service-category">
        ${escapeHtml(service.category)}
      </span>

      <h3>${escapeHtml(service.name)}</h3>

      <span class="state">${stateLabel}</span>

      <div class="data-list">
        ${renderRow('HTTP', service.http_status ?? 'Sin respuesta')}
        ${renderRow('Respuesta', `${service.response_time_ms} ms`)}
        ${renderRow('Estado', service.status)}
      </div>

      <a href="${escapeHtml(service.url)}"
         target="_blank"
         rel="noreferrer">
        Abrir servicio
      </a>
    </article>
  `;
}

function renderContainer(container) {
  const stats = container.stats || {};
  const stateClass = container.running ? '' : ' offline';
  const stateLabel = container.running ? 'RUNNING' : 'OFFLINE';

  return `
    <article class="docker-card${stateClass}">
      <span class="state">${stateLabel}</span>

      <h3>${escapeHtml(container.name)}</h3>

      <div class="data-list">
        ${renderRow('Estado', container.status)}
        ${renderRow('CPU', stats.cpu)}
        ${renderRow('Memoria', stats.memory_usage)}
        ${renderRow('Uso RAM', stats.memory_percent)}
        ${renderRow('Procesos', stats.processes)}
      </div>
    </article>
  `;
}

function updateGlobalStatus(ecosystem, docker) {
  const ecosystemHealthy = ecosystem?.healthy === true;
  const dockerHealthy = docker?.stopped === 0;

  if (ecosystemHealthy && dockerHealthy) {
    elements.globalStatus.textContent = '● SISTEMA OPERATIVO';
    elements.globalStatus.className = 'global-status online';
    return;
  }

  elements.globalStatus.textContent = '● REVISIÓN REQUERIDA';
  elements.globalStatus.className = 'global-status offline';
}

async function loadDashboard() {
  const response = await fetch('/api/dashboard', {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Dashboard HTTP ${response.status}`);
  }

  return response.json();
}



async function refreshDashboard() {
  try {
    const dashboard = await loadDashboard();

const ecosystem = dashboard.data.ecosystem;
const docker = dashboard.data.docker;

elements.ecosystemTotal.textContent = ecosystem.total;
elements.ecosystemOnline.textContent = ecosystem.online;
elements.ecosystemOffline.textContent = ecosystem.offline;
elements.ecosystemChecked.textContent =
  ecosystem.checked_at
    ? 'Actualizado: ' +
      new Date(ecosystem.checked_at).toLocaleString('es-NI')
    : 'Estado actualizado';

elements.ecosystemGrid.innerHTML =
  ecosystem.services.length
    ? ecosystem.services.map(renderService).join('')
    : '<div class="message">Sin datos</div>';

elements.dockerTotal.textContent = docker.total;
elements.dockerRunning.textContent = docker.running;
elements.dockerStopped.textContent = docker.stopped;

elements.dockerChecked.textContent =
  docker.checked_at
    ? 'Actualizado: ' +
      new Date(docker.checked_at).toLocaleString('es-NI')
    : 'Estado actualizado';

elements.dockerGrid.innerHTML =
  docker.containers.length
    ? docker.containers.map(renderContainer).join('')
    : '<div class="message">Sin datos</div>';

updateGlobalStatus(ecosystem,docker);
  } catch (error) {
    elements.globalStatus.textContent = '● SIN CONEXIÓN';
    elements.globalStatus.className = 'global-status offline';

    console.error('Dashboard refresh error:', error);
  }
}

refreshDashboard();
setInterval(refreshDashboard, 30000);


// ORCH-015A — Job Engine

const jobElements = {
  form: document.getElementById('job-form'),
  platform: document.getElementById('job-platform'),
  task: document.getElementById('job-task'),
  submit: document.getElementById('job-submit'),
  message: document.getElementById('job-form-message'),
  checked: document.getElementById('jobs-checked'),
  refresh: document.getElementById('jobs-refresh'),
  list: document.getElementById('jobs-list'),
  detail: document.getElementById('job-detail')
};

let activeJobId = null;
let jobsRefreshRunning = false;

function normalizeJobStatus(status) {
  return String(status || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function formatJobDate(value) {
  if (!value) {
    return 'No disponible';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('es-NI');
}

function renderJobListItem(job) {
  const status = normalizeJobStatus(job.status);
  const activeClass = job.id === activeJobId ? ' active' : '';

  return `
    <button
      type="button"
      class="job-list-button${activeClass}"
      data-job-id="${escapeHtml(job.id)}"
    >
      <span class="job-list-top">
        <span class="job-list-platform">
          ${escapeHtml(job.platform)}
        </span>

        <span class="job-status ${escapeHtml(status)}">
          ${escapeHtml(job.status || 'Sin estado')}
        </span>
      </span>

      <span class="job-list-task">
        ${escapeHtml(job.task)}
      </span>

      <span class="job-list-platform">
        ${escapeHtml(formatJobDate(job.createdAt))}
      </span>
    </button>
  `;
}

function renderJobSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return '<p>No hay pasos registrados.</p>';
  }

  return `
    <div class="job-steps">
      ${steps.map((step, index) => {
        const label =
          typeof step === 'string'
            ? step
            : step?.name ||
              step?.label ||
              step?.status ||
              JSON.stringify(step);

        return `
          <div class="job-step">
            ${index + 1}. ${escapeHtml(label)}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderJobResult(value) {
  if (value === null || value === undefined || value === '') {
    return 'Resultado todavía no disponible.';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ORCH-020 — PR asociado automáticamente al Job

let prControlsReady = false;

function normalizePrPlatform(platform) {
  const value = String(platform || '')
    .trim()
    .toLowerCase();

  const aliases = {
    elanvisual: 'elanvisual',
    elanpet: 'elanpet',
    'elankav-core': 'elankav-core',
    'elankav-platform': 'elankav-platform'
  };

  return aliases[value] || '';
}

function findJobPullRequest(value, visited = new Set()) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (visited.has(value)) {
    return null;
  }

  visited.add(value);

  const directPullRequest =
    value.pullRequest && typeof value.pullRequest === 'object'
      ? value.pullRequest
      : null;

  const directNumber = Number(
    directPullRequest?.number ??
    value.pullRequestNumber ??
    (
      value.step === 'pr'
        ? value.number
        : undefined
    )
  );

  if (Number.isInteger(directNumber) && directNumber > 0) {
    return {
      number: directNumber,
      url:
        directPullRequest?.url ||
        value.url ||
        null
    };
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPullRequest(item, visited);

      if (found) {
        return found;
      }
    }

    return null;
  }

  for (const nested of Object.values(value)) {
    const found = findJobPullRequest(nested, visited);

    if (found) {
      return found;
    }
  }

  return null;
}

function syncPullRequestFromJob(job) {
  if (!prControlsReady) {
    return;
  }

  const platform = normalizePrPlatform(job?.platform);
  const pullRequest = findJobPullRequest(job?.result);

  if (platform) {
    prElements.platform.value = platform;
  }

  if (!pullRequest) {
    prElements.number.value = '';
    prElements.result.innerHTML =
      '<p>Este Job todavía no tiene Pull Request asociado.</p>';
    return;
  }

  prElements.number.value = String(pullRequest.number);

  prElements.result.innerHTML = `
    <p>
      Job asociado automáticamente al PR
      <strong>#${escapeHtml(pullRequest.number)}</strong>.
    </p>
  `;

  if (prElements.token.value.trim()) {
    inspectCurrentPullRequest();
  }
}

function renderJobDetail(job) {
  const status = normalizeJobStatus(job.status);

  jobElements.detail.innerHTML = `
    <div class="job-detail-header">
      <div>
        <span class="service-category">
          DETALLE DEL JOB
        </span>
        <h3>${escapeHtml(job.id)}</h3>
      </div>

      <span class="job-status ${escapeHtml(status)}">
        ${escapeHtml(job.status || 'Sin estado')}
      </span>
    </div>

    <div class="job-detail-grid">
      <div class="job-detail-block">
        <span>Plataforma</span>
        <strong>${escapeHtml(job.platform)}</strong>
      </div>

      <div class="job-detail-block">
        <span>Rama temporal</span>
        <strong>${escapeHtml(job.branch || 'Pendiente')}</strong>
      </div>

      <div class="job-detail-block">
        <span>Creado</span>
        <strong>${escapeHtml(formatJobDate(job.createdAt))}</strong>
      </div>

      <div class="job-detail-block">
        <span>Finalizado</span>
        <strong>${escapeHtml(formatJobDate(job.finishedAt))}</strong>
      </div>

      <div class="job-detail-block full">
        <span>Instrucción</span>
        <p>${escapeHtml(job.task)}</p>
      </div>

      <div class="job-detail-block full">
        <span>Pasos</span>
        ${renderJobSteps(job.steps)}
      </div>

      <div class="job-detail-block full">
        <span>Resultado</span>
        <pre class="job-result">${escapeHtml(renderJobResult(job.result))}</pre>
      </div>

      ${job.error ? `
        <div class="job-detail-block full">
          <span>Error</span>
          <pre class="job-result">${escapeHtml(renderJobResult(job.error))}</pre>
        </div>
      ` : ''}
    </div>
  `;

  syncPullRequestFromJob(job);
}

async function fetchJobs() {
  const response = await fetch('/api/jobs', {
    cache: 'no-store'
  });

  const data = await response.json();

  if (!response.ok || data.success !== true) {
    throw new Error(data.error || `Jobs HTTP ${response.status}`);
  }

  return Array.isArray(data.jobs) ? data.jobs : [];
}

async function fetchJob(jobId) {
  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}`,
    { cache: 'no-store' }
  );

  const data = await response.json();

  if (!response.ok || data.success !== true) {
    throw new Error(data.error || `Job HTTP ${response.status}`);
  }

  return data.job;
}

async function refreshJobs({ refreshDetail = true } = {}) {
  if (jobsRefreshRunning) {
    return;
  }

  jobsRefreshRunning = true;

  try {
    const jobs = await fetchJobs();

    jobElements.checked.textContent =
      `Actualizado: ${new Date().toLocaleString('es-NI')}`;

    jobElements.list.innerHTML = jobs.length
      ? jobs.map(renderJobListItem).join('')
      : '<div class="message">No hay Jobs registrados.</div>';

    if (refreshDetail && activeJobId) {
      const job = await fetchJob(activeJobId);
      renderJobDetail(job);
    }
  } catch (error) {
    jobElements.checked.textContent = 'No fue posible consultar Jobs';
    jobElements.list.innerHTML = `
      <div class="message">
        ${escapeHtml(error.message)}
      </div>
    `;
    console.error('Jobs refresh error:', error);
  } finally {
    jobsRefreshRunning = false;
  }
}

async function openJob(jobId) {
  activeJobId = jobId;

  try {
    const job = await fetchJob(jobId);
    renderJobDetail(job);
    await refreshJobs({ refreshDetail: false });
  } catch (error) {
    jobElements.detail.innerHTML = `
      <div class="message">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

async function createJob(event) {
  event.preventDefault();

  const platform = jobElements.platform.value.trim();
  const task = jobElements.task.value.trim();

  if (!platform || !task) {
    jobElements.message.textContent =
      'Plataforma e instrucción son obligatorias.';
    jobElements.message.className = 'form-message error';
    return;
  }

  jobElements.submit.disabled = true;
  jobElements.message.textContent = 'Creando Job...';
  jobElements.message.className = 'form-message';

  try {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        platform,
        task
      })
    });

    const data = await response.json();

    if (!response.ok || data.success !== true) {
      throw new Error(data.error || `Job HTTP ${response.status}`);
    }

    activeJobId = data.jobId;
    jobElements.task.value = '';
    jobElements.message.textContent =
      `Job creado: ${data.jobId}`;
    jobElements.message.className = 'form-message success';

    await refreshJobs({ refreshDetail: false });
    await openJob(data.jobId);
  } catch (error) {
    jobElements.message.textContent = error.message;
    jobElements.message.className = 'form-message error';
  } finally {
    jobElements.submit.disabled = false;
  }
}

jobElements.form.addEventListener('submit', createJob);

jobElements.refresh.addEventListener('click', () => {
  refreshJobs();
});

jobElements.list.addEventListener('click', event => {
  const button = event.target.closest('[data-job-id]');

  if (!button) {
    return;
  }

  openJob(button.dataset.jobId);
});

refreshJobs();

setInterval(() => {
  refreshJobs();
}, 5000);

// ===============================
// ORCH-015B
// Pull Request
// ===============================

async function fetchPullRequest(number, platform, token) {
  const response = await fetch(
    `/api/pull-requests/${number}?platform=${encodeURIComponent(platform)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  return response.json();
}

async function approvePullRequest(number, platform, token) {
  const response = await fetch(
    `/api/pull-requests/${number}/decision`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        platform,
        action: 'approve',
        confirmation: `APPROVE PR ${number}`
      })
    }
  );

  return response.json();
}

async function rejectPullRequest(number, platform, token, reason) {
  const response = await fetch(
    `/api/pull-requests/${number}/decision`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        platform,
        action: 'reject',
        confirmation: `REJECT PR ${number}`,
        reason
      })
    }
  );

  return response.json();
}

const prElements = {
  platform: document.getElementById('pr-platform'),
  number: document.getElementById('pr-number'),
  token: document.getElementById('pr-token'),
  inspect: document.getElementById('pr-inspect'),
  approve: document.getElementById('pr-approve'),
  reject: document.getElementById('pr-reject'),
  result: document.getElementById('pr-result')
};

prControlsReady = true;

try {
  const savedToken =
    sessionStorage.getItem('elankav.prApprovalToken');

  if (savedToken) {
    prElements.token.value = savedToken;
  }
} catch (error) {
  console.warn('No fue posible recuperar el token de sesión:', error);
}

prElements.token.addEventListener('input', () => {
  try {
    const token = prElements.token.value.trim();

    if (token) {
      sessionStorage.setItem(
        'elankav.prApprovalToken',
        token
      );
    } else {
      sessionStorage.removeItem(
        'elankav.prApprovalToken'
      );
    }
  } catch (error) {
    console.warn('No fue posible guardar el token de sesión:', error);
  }
});

function getPrInput() {
  const platform = prElements.platform.value.trim();
  const number = Number(prElements.number.value);
  const token = prElements.token.value.trim();

  if (!platform) {
    throw new Error('Plataforma obligatoria');
  }

  if (!Number.isInteger(number) || number < 1) {
    throw new Error('Número de PR inválido');
  }

  if (!token) {
    throw new Error('Token obligatorio');
  }

  return {
    platform,
    number,
    token
  };
}

function renderPullRequest(data) {
  if (data.success !== true) {
    prElements.result.innerHTML = `
      <p>${escapeHtml(data.error || 'No fue posible consultar el PR')}</p>
    `;
    return;
  }

  const pullRequest = data.pullRequest;
  const checks = data.checks;

  prElements.result.innerHTML = `
    <div class="data-list">
      ${renderRow('Repositorio', data.repository)}
      ${renderRow('PR', `#${pullRequest.number}`)}
      ${renderRow('Título', pullRequest.title)}
      ${renderRow('Estado', pullRequest.state)}
      ${renderRow(
        'Checks',
        checks.healthy
          ? `OK (${checks.total})`
          : `Bloqueados (${checks.total})`
      )}
      ${renderRow('Mergeable', pullRequest.mergeable)}
      ${renderRow('Origen', pullRequest.headBranch)}
      ${renderRow('Destino', pullRequest.baseBranch)}
    </div>

    <p>
      <a
        href="${escapeHtml(pullRequest.url)}"
        target="_blank"
        rel="noreferrer"
      >
        Abrir Pull Request en GitHub
      </a>
    </p>
  `;
}

async function inspectCurrentPullRequest() {
  try {
    const input = getPrInput();

    prElements.result.innerHTML = '<p>Consultando PR...</p>';

    const data = await fetchPullRequest(
      input.number,
      input.platform,
      input.token
    );

    renderPullRequest(data);
  } catch (error) {
    prElements.result.innerHTML = `
      <p>${escapeHtml(error.message)}</p>
    `;
  }
}

prElements.inspect.addEventListener('click', inspectCurrentPullRequest);

prElements.approve.addEventListener('click', async () => {
  try {
    const input = getPrInput();

    if (!confirm(`¿Aprobar y mergear PR #${input.number}?`)) {
      return;
    }

    prElements.result.innerHTML = '<p>Aprobando PR...</p>';

    const data = await approvePullRequest(
      input.number,
      input.platform,
      input.token
    );

    renderPullRequest(data);
  } catch (error) {
    prElements.result.innerHTML = `
      <p>${escapeHtml(error.message)}</p>
    `;
  }
});

prElements.reject.addEventListener('click', async () => {
  try {
    const input = getPrInput();
    const reason = prompt('Motivo del rechazo:') || '';

    if (!confirm(`¿Rechazar PR #${input.number}?`)) {
      return;
    }

    prElements.result.innerHTML = '<p>Rechazando PR...</p>';

    const data = await rejectPullRequest(
      input.number,
      input.platform,
      input.token,
      reason
    );

    renderPullRequest(data);
  } catch (error) {
    prElements.result.innerHTML = `
      <p>${escapeHtml(error.message)}</p>
    `;
  }
});
