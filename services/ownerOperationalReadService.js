'use strict';

const { listJobs } = require('./jobs/jobEngine');

const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const DEFAULT_WAHA_SESSION = 'ELANKAV';

const CAPABILITIES = Object.freeze([
  ['owner.jobs.status', 'Orchestrator', 'Consulta un Job por ID', true],
  ['owner.jobs.list', 'Orchestrator', 'Lista Jobs recientes', true],
  ['owner.waha.status', 'WAHA', 'Consulta el estado de la sesión configurada', true],
  ['owner.waha.send_design_link', 'WAHA', 'Envía el enlace oficial de diseño', true],
  ['owner.quote.query', 'CONNECT/Quote Runtime', 'Consulta cotizaciones mediante el runtime habilitado', true],
  ['owner.context.sync', 'Orchestrator', 'Sincroniza contexto oficial mediante Job', true],
  ['owner.code.job', 'Codex', 'Crea un Job de programación aislado', true]
]);

function createHeaders(env = process.env) {
  const headers = { Accept: 'application/json' };
  const apiKey = String(env.WAHA_API_KEY || env.WAHA_API_TOKEN || '').trim();
  if (apiKey) headers['X-Api-Key'] = apiKey;
  return headers;
}

async function readWahaSession({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = String(env.WAHA_BASE_URL || DEFAULT_WAHA_BASE_URL).replace(/\/+$/, '');
  const session = String(env.WAHA_SESSION || DEFAULT_WAHA_SESSION).trim();
  const checkedAt = new Date().toISOString();
  const response = await fetchImpl(`${baseUrl}/api/sessions/${encodeURIComponent(session)}`, {
    method: 'GET',
    headers: createHeaders(env)
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `WAHA HTTP ${response.status}`);
    error.code = `WAHA_HTTP_${response.status}`;
    throw error;
  }

  return Object.freeze({
    session,
    status: data?.status || 'UNKNOWN',
    engine: data?.engine?.engine || data?.engine?.name || data?.engine || null,
    me: data?.me || null,
    webhooks: Array.isArray(data?.config?.webhooks) ? data.config.webhooks : [],
    checkedAt
  });
}

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 'No disponible';
  return digits.length <= 4 ? '****' : `${digits.slice(0, -4)}****`;
}

function formatWahaStatus(result) {
  const phone = result.me?.id || result.me?.pushName || result.me?.phone || null;
  const webhookLines = result.webhooks.length
    ? result.webhooks.map(item => `- ${item.url || 'sin URL'} [${(item.events || []).join(', ') || 'sin eventos'}]`)
    : ['- Ninguno expuesto por WAHA'];

  return [
    'Estado WAHA verificado en tiempo real.',
    '',
    `Sesión: ${result.session}`,
    `Estado: ${result.status}`,
    `Engine: ${result.engine || 'No disponible'}`,
    `Cuenta: ${maskPhone(phone)}`,
    'Webhooks:',
    ...webhookLines,
    `Consultado: ${result.checkedAt}`
  ].join('\n');
}

async function getRecentJobs(limit = 3) {
  const rows = await listJobs();
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || 3, 10)));
}

function formatRecentJobs(jobs) {
  if (!jobs.length) return 'No hay Jobs registrados.';
  return [
    'Jobs recientes verificados.',
    '',
    ...jobs.flatMap((job, index) => [
      `${index + 1}. ${job.id}`,
      `Plataforma: ${job.platform || 'No disponible'}`,
      `Estado: ${job.status || 'No disponible'}`,
      `Creado: ${job.createdAt || 'No disponible'}`,
      `Finalizado: ${job.finishedAt || 'No disponible'}`,
      `Rama: ${job.branch || 'No aplica'}`,
      `Error: ${job.error || 'Ninguno'}`,
      ''
    ])
  ].join('\n').trim();
}

function formatCapabilityCatalog() {
  return [
    'Catálogo verificado de capacidades Owner actualmente registradas en código.',
    '',
    'ACCIÓN | DESTINO | TIPO | HABILITADA',
    ...CAPABILITIES.map(([name, destination, description, enabled]) =>
      `${name} | ${destination} | ${description} | ${enabled ? 'SÍ' : 'NO'}`
    )
  ].join('\n');
}

module.exports = {
  CAPABILITIES,
  formatCapabilityCatalog,
  formatRecentJobs,
  formatWahaStatus,
  getRecentJobs,
  readWahaSession
};
