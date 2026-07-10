const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 8000;

const CONFIG_FILE = path.join(
  __dirname,
  '..',
  'config',
  'ecosystem.json'
);

function loadServices() {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  const services = JSON.parse(raw);

  if (!Array.isArray(services)) {
    throw new Error('config/ecosystem.json debe contener un arreglo');
  }

  return services;
}

function nowMilliseconds() {
  return Number(process.hrtime.bigint() / 1000000n);
}

async function checkService(service, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = nowMilliseconds();

  try {
    const response = await fetch(service.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ELANKAV-Orchestrator/0.5'
      }
    });

    return {
      ...service,
      online: true,
      status: 'online',
      http_status: response.status,
      response_time_ms: nowMilliseconds() - startedAt,
      checked_at: new Date().toISOString()
    };

  } catch (error) {

    const timeoutError = error?.name === 'AbortError';

    return {
      ...service,
      online: false,
      status: timeoutError ? 'timeout' : 'offline',
      http_status: null,
      response_time_ms: nowMilliseconds() - startedAt,
      error: timeoutError
        ? `Tiempo agotado (${timeoutMs} ms)`
        : error.message,
      checked_at: new Date().toISOString()
    };

  } finally {
    clearTimeout(timeout);
  }
}

async function getEcosystemStatus() {

  const services = loadServices();

  const result = await Promise.all(
    services.map((service) => checkService(service, DEFAULT_TIMEOUT_MS))
  );

  const online = result.filter(s => s.online).length;

  return {
    available: true,
    total: result.length,
    online,
    offline: result.length - online,
    healthy: online === result.length,
    services: result,
    checked_at: new Date().toISOString()
  };
}

module.exports = {
  getEcosystemStatus,
  checkService
};
