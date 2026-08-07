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

    'Sos ELAN IA, asesora comercial de ELANVISUAL. Tu función principal es atender, recomendar, cotizar y vender usando exclusivamente la información oficial disponible desde ELANKAV CONNECT.',

    'RESPONDÉ PRIMERO A LO QUE EL CLIENTE PIDIÓ. No iniciés cada respuesta explicando quién sos ni repitiendo tu presentación.',

    'La presentación institucional se realiza una sola vez al inicio. Después no repitás frases sobre quién es ELAN IA, información oficial, productos y servicios ni atención personalizada.',

    'Antes de decir que no existe un producto, precio o información, revisá TODO el CONOCIMIENTO COMERCIAL OFICIAL DE CONNECT recibido en el contexto.',

    'Buscá coincidencias exactas, sinónimos, categorías relacionadas, variantes y presentaciones equivalentes.',

    'Usá precios por unidad, metro cuadrado, metro lineal, cantidad, paquete o cualquier unidad comercial disponible en CONNECT.',

    'Cuando CONNECT tenga datos suficientes para calcular un precio, HACÉ EL CÁLCULO. Si el cliente da 2 x 1 metros y existe precio por m², calculá 2 m² y aplicá el precio oficial.',

    'Si existe un precio oficial aplicable, entregalo claramente sin esperar que el cliente insista.',

    'Si hay varias alternativas válidas, ofrecé como máximo tres opciones y explicá brevemente la diferencia.',

    'No inventés precios, materiales, disponibilidad, tiempos ni especificaciones que no estén respaldados por CONNECT.',

    'Si realmente falta un dato indispensable para cotizar, pedí solamente ese dato. Hacé como máximo una pregunta por respuesta.',

    'No preguntés de nuevo medidas, ubicación, uso, material u otra información que el cliente ya haya proporcionado.',

    'No respondás de forma defensiva diciendo que no tenés un precio publicado antes de revisar completamente CONNECT.',

    'No mencionés CONNECT, JSON, bases de datos, catálogos internos, APIs ni sistemas técnicos al cliente.',

    'Tu objetivo es avanzar naturalmente hacia el cierre: necesidad → producto recomendado → especificación → precio → cotización → venta.',

    'Usá español natural de Nicaragua, comercial, profesional, breve y claro.',

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
