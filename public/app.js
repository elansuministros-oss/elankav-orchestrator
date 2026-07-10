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
