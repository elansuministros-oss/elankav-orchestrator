'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const DEFAULT_TIMEOUT_MS = 12_000;

function clean(value) {
  return String(value || '').trim();
}

function normalizePlatform(value) {
  const normalized = clean(value).toLowerCase();
  const aliases = {
    visual: 'elanvisual',
    elanvisual: 'elanvisual',
    home: 'elanhome',
    elanhome: 'elanhome',
    pet: 'elanpet',
    elanpet: 'elanpet'
  };
  return aliases[normalized] || 'elanvisual';
}

function resolveConnectUrl() {
  return clean(process.env.ELANKAV_CONNECT_URL || process.env.CONNECT_API_URL || DEFAULT_CONNECT_URL)
    .replace(/\/+$/, '');
}

function resolveInternalToken() {
  return clean(
    process.env.CONNECT_INTERNAL_API_TOKEN ||
    process.env.CONNECT_INTERNAL_TOKEN ||
    process.env.ORCHESTRATOR_INTERNAL_TOKEN
  );
}

function runtimeHeaders() {
  const token = resolveInternalToken();
  if (!token) {
    const error = new Error('CONNECT_INTERNAL_API_TOKEN_REQUIRED');
    error.code = 'CONNECT_INTERNAL_API_TOKEN_REQUIRED';
    error.status = 503;
    throw error;
  }
  return {
    Accept: 'application/json',
    'X-Elankav-Internal-Token': token,
    'X-Elankav-Platform': 'ORCHESTRATOR',
    'X-Elankav-Actor-Type': 'system'
  };
}

async function readError(response) {
  const payload = await response.json().catch(() => ({}));
  const error = new Error(payload?.error?.message || `CONNECT_RUNTIME_HTTP_${response.status}`);
  error.code = payload?.error?.code || 'CONNECT_RUNTIME_REQUEST_FAILED';
  error.status = response.status;
  error.details = payload;
  return error;
}

async function getPublishedRuntime(platform, fetchImpl = fetch) {
  const platformId = normalizePlatform(platform);
  const response = await fetchImpl(
    `${resolveConnectUrl()}/console/api/ai-platforms/runtime/${encodeURIComponent(platformId)}`,
    {
      method: 'GET',
      headers: runtimeHeaders(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    }
  );
  if (!response.ok) throw await readError(response);
  const payload = await response.json();
  return {
    ...payload,
    platformId,
    shouldRespond: Boolean(payload?.execution?.shouldRespond)
  };
}

function stringifyRuleSet(value) {
  if (!value || typeof value !== 'object') return '';
  return JSON.stringify(value, null, 2);
}

function buildCustomerInstructions(runtime) {
  const platform = runtime?.platform || {};
  return [
    clean(platform.instructions),
    'Respondé como ELAN IA para clientes externos.',
    'Respondé siempre primero a lo que el cliente preguntó.',
    'Hacé como máximo una pregunta por respuesta.',
    'No inventés precios, materiales, medidas, tiempos ni disponibilidad.',
    'No afirmés que un producto sirve para interior o exterior sin usar el contexto oficial.',
    'Cuando el cliente ya dio medida y ubicación interior/exterior, no repitás esas preguntas.',
    'Si insiste en conocer precio y hay un precio oficial disponible, entregalo claramente.',
    'Si falta información oficial, explicá exactamente qué dato falta y pedí solo ese dato.',
    'Usá español natural de Nicaragua, profesional, breve y claro.',
    stringifyRuleSet(platform.responseRules),
    stringifyRuleSet(platform.continuity),
    stringifyRuleSet(platform.catalogAccess)
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  DEFAULT_CONNECT_URL,
  buildCustomerInstructions,
  getPublishedRuntime,
  normalizePlatform,
  resolveConnectUrl,
  resolveInternalToken
};
