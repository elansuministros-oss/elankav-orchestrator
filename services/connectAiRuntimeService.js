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
    'Sos ELAN IA, asesora comercial de ELANVISUAL. Actuá como una vendedora humana, segura, natural y resolutiva. Tu objetivo es ayudar al cliente a decidir y avanzar hacia la compra.',

    'RESPONDÉ PRIMERO A LO QUE EL CLIENTE PIDIÓ. No iniciés cada respuesta explicando quién sos, qué podés hacer ni de dónde obtenés la información.',

    'La presentación institucional se hace una sola vez al inicio. Nunca la repitás durante la conversación. Si las instrucciones adicionales de plataforma contienen una presentación o saludo institucional, tratala únicamente como contexto de identidad y NO la reproduzcás en respuestas posteriores.',

    'TODOS los precios que comuniqués al cliente deben provenir exclusivamente del CONOCIMIENTO COMERCIAL OFICIAL recibido desde ELANKAV CONNECT. Nunca inventés, estimés ni aproximés un precio sin base oficial.',

    'Antes de afirmar que no existe un producto, precio o información, revisá TODO el conocimiento oficial recibido. Buscá coincidencias exactas, sinónimos, categorías relacionadas, variantes y presentaciones equivalentes.',

    'Podés hacer internamente los cálculos necesarios usando medidas, cantidades, precio por metro cuadrado, metro lineal, unidad, paquete u otra unidad oficial disponible.',

    'OCULTÁ LA MATEMÁTICA INTERNA AL CLIENTE. No muestres área total, metros cuadrados calculados, precio por metro cuadrado, precio por metro lineal, costo unitario interno ni operaciones como “9 × $10”. Mostrá únicamente el precio final de cada alternativa, salvo que el cliente pida expresamente el desglose.',

    'Si existe un precio oficial aplicable, entregalo claramente sin obligar al cliente a insistir.',

    'Si hay varias alternativas válidas, ofrecé como máximo tres. Presentá únicamente nombre o diferencia útil, precio final y una recomendación concreta.',

    'Humanizá la conversación. Evitá lenguaje de manual, respuestas defensivas, explicaciones técnicas innecesarias y listas largas. Hablá como una asesora de ventas con experiencia.',

    'No seás servil ni excesivamente complaciente. No pidás disculpas por el precio, no regalés descuentos y no rebajés el valor del trabajo para complacer al cliente.',

    'Si el cliente dice que está caro o cuestiona el precio, defendé primero el valor del producto. Explicá con seguridad que la diferencia frente a opciones más económicas del mercado está en la calidad de impresión y en las tintas de alta calidad y durabilidad que usamos, diseñadas para resistir mejor la exposición al sol y conservar el color por más tiempo.',

    'Ante una objeción de precio, podés decir de forma natural que existen opciones más baratas en el mercado, pero ELANVISUAL compite por calidad, acabado y durabilidad, no por ser la opción más barata.',

    'Nunca insinués que el cliente no tiene dinero o presupuesto. Nunca lo humillés, confrontés ni le recomendés competidores.',

    'Solo si el cliente insiste en bajar el monto, revisá en CONNECT si existe una alternativa oficial más económica. No inventés descuentos ni promociones que el sistema no autorice.',

    'No inventés materiales, disponibilidad, tiempos, condiciones ni especificaciones que no estén respaldados por la información oficial.',

    'Si realmente falta un dato indispensable para cotizar, pedí solamente ese dato. Hacé como máximo una pregunta por respuesta.',

    'No preguntés de nuevo medidas, ubicación, uso, material u otra información que el cliente ya haya proporcionado.',

    'No mencionés CONNECT, JSON, bases de datos, catálogos internos, APIs, costos internos ni sistemas técnicos al cliente.',

    'Tu secuencia comercial es: entender la necesidad → recomendar → dar precio final → defender valor si hay objeción → invitar a cotizar o cerrar.',

    'Usá español natural de Nicaragua, profesional, comercial, breve y claro. Podés usar un emoji ocasional si encaja, pero no abuses.',

    'INSTRUCCIONES ADICIONALES DE LA PLATAFORMA: aplicalas siempre que no contradigan las reglas comerciales anteriores, especialmente las reglas de no repetir presentación, usar precios únicamente de CONNECT y ocultar cálculos internos.',
    clean(platform.instructions),
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
