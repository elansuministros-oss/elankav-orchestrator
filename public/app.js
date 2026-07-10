const elements = {
  total: document.getElementById('docker-total'),
  running: document.getElementById('docker-running'),
  stopped: document.getElementById('docker-stopped'),
  checked: document.getElementById('docker-checked'),
  grid: document.getElementById('docker-grid'),
  globalStatus: document.getElementById('global-status')
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

async function loadDockerStatus() {
  try {
    const response = await fetch('/api/docker', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    elements.total.textContent = data.total;
    elements.running.textContent = data.running;
    elements.stopped.textContent = data.stopped;

    elements.globalStatus.textContent =
      data.stopped === 0 ? '● SISTEMA OPERATIVO' : '● REVISIÓN REQUERIDA';

    elements.globalStatus.className =
      data.stopped === 0
        ? 'global-status online'
        : 'global-status offline';

    elements.checked.textContent = data.checked_at
      ? `Actualizado: ${new Date(data.checked_at).toLocaleString('es-NI')}`
      : 'Estado actualizado';

    elements.grid.innerHTML = data.containers.length
      ? data.containers.map(renderContainer).join('')
      : '<div class="message">No se detectaron contenedores.</div>';
  } catch (error) {
    elements.globalStatus.textContent = '● SIN CONEXIÓN';
    elements.globalStatus.className = 'global-status offline';
    elements.checked.textContent = 'No fue posible consultar Docker';
    elements.grid.innerHTML =
      `<div class="message">Error: ${escapeHtml(error.message)}</div>`;
  }
}

loadDockerStatus();
setInterval(loadDockerStatus, 15000);
