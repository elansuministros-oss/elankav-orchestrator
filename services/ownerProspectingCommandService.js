'use strict';

const { createHmac } = require('node:crypto');

const COMMAND_TYPE = 'business_prospecting_mission_create';
const MAX_TARGET_COMPANIES = 500;
const ACTIVE_MISSION_STATUSES = new Set(['draft', 'running', 'partial', 'paused']);
const SUPPLIER_MARKER = 'SUPPLIER_PROSPECTING';

class OwnerProspectingError extends Error {
  constructor(code, message, statusCode = 500, details = null) {
    super(message || code || 'OWNER_PROSPECTING_ERROR');
    this.name = 'OwnerProspectingError';
    this.code = code || 'OWNER_PROSPECTING_ERROR';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function cleanMissionText(message) {
  return String(message || '')
    .trim()
    .replace(/^elan[\s,;:.-]+/i, '')
    .trim();
}

function isSupplierProspectingMission(value) {
  const normalized = normalize(value);
  return normalized.includes(normalize(SUPPLIER_MARKER)) || /\b(proveedor|proveedores|suplidor|suplidores)\b/.test(normalized);
}

function supplierMissionText(mission) {
  const clean = String(mission || '').trim();
  if (!clean || clean.includes(SUPPLIER_MARKER)) return clean;
  return [
    SUPPLIER_MARKER,
    clean,
    'Investiga exclusivamente empresas que puedan suministrar materiales, productos, fabricación, impresión, instalación, logística, equipos o servicios solicitados.',
    'Clasifica ubicación pública por país, departamento y ciudad o municipio cuando esté disponible.',
    'Registra productos, servicios, capacidades, cobertura y contactos comerciales públicos dentro de la evidencia disponible.',
    'No las evalúes como clientes de ELANVISUAL y no ejecutes outreach.'
  ].join('. ');
}

function detectOwnerProspectingCommand(message) {
  const mission = cleanMissionText(message);
  const normalized = normalize(mission);
  if (!mission) return null;

  const searchIntent = /^(?:buscar|busca|busca|encontrar|encuentra|localizar|localiza|investigar|investiga)\b/.test(normalized);
  if (!searchIntent) return null;

  const supplierIntent = /\b(proveedor|proveedores|suplidor|suplidores)\b/.test(normalized);
  const targetMatch = normalized.match(/\b(\d{1,3})\s+(?:empresas|negocios|prospectos|proveedores|suplidores)\b/);
  if (!targetMatch) return null;

  const targetCompanies = Number(targetMatch[1]);
  if (!Number.isInteger(targetCompanies) || targetCompanies < 1 || targetCompanies > MAX_TARGET_COMPANIES) {
    return null;
  }

  const hasProspectingIntent = supplierIntent ||
    /\b(presencia fisica|prospect|decisor|mercadeo|marketing|compras|procurement|elanvisual|contactos? publicos?|empresas?)\b/.test(normalized);
  if (!hasProspectingIntent) return null;

  return {
    type: COMMAND_TYPE,
    input: {
      businessUnit: 'ELANVISUAL',
      mission: supplierIntent ? supplierMissionText(mission) : mission,
      mode: 'continuous',
      country: 'Nicaragua',
      targetCompanies,
      prospectType: supplierIntent ? 'supplier' : 'customer'
    }
  };
}

function resolveInternalToken(env = process.env) {
  const explicit = String(env.CONNECT_INTERNAL_API_TOKEN || '').trim();
  if (explicit) return explicit;

  const vqs = String(env.VQS_API_TOKEN || '').trim();
  if (!vqs) {
    throw new OwnerProspectingError(
      'CONNECT_INTERNAL_TOKEN_REQUIRED',
      'No está configurada una credencial interna válida para Prospecting.',
      503
    );
  }

  return createHmac('sha256', vqs)
    .update('ELANKAV_CHANNEL_INTERNAL_V1')
    .digest('hex');
}

function config(env = process.env) {
  const baseUrl = String(env.CONNECT_BASE_URL || 'https://connect.elankav.com')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new OwnerProspectingError('CONNECT_BASE_URL_INVALID', 'CONNECT_BASE_URL no es válido.', 503);
  }
  return { baseUrl, token: resolveInternalToken(env) };
}

function assertAllowedRequest(path, method) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const allowed =
    (path === '/api/v1/prospecting/control-status' && normalizedMethod === 'GET') ||
    (path.startsWith('/api/v1/prospecting/audit') && normalizedMethod === 'GET') ||
    (path.startsWith('/api/v1/prospecting/missions') && ['GET', 'POST'].includes(normalizedMethod)) ||
    (path.startsWith('/api/v1/prospecting/outreach-campaigns') && ['GET', 'POST', 'PATCH'].includes(normalizedMethod));

  if (!allowed) {
    throw new OwnerProspectingError(
      'PROSPECTING_PATH_NOT_ALLOWED',
      'Ruta Prospecting no autorizada para Owner WhatsApp.',
      403
    );
  }
}

async function requestProspecting(path, options = {}, env = process.env) {
  const method = String(options.method || 'GET').toUpperCase();
  assertAllowedRequest(path, method);
  const { baseUrl, token } = config(env);

  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Elankav-Internal-Token': token,
      'X-Elankav-Actor-Type': 'owner',
      'X-Elankav-Actor-Role': 'owner',
      'X-Elankav-Actor-Id': 'owner-whatsapp',
      'X-Elankav-Platform': 'ELANVISUAL',
      'X-Elankav-Source': 'OWNER_WHATSAPP'
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const nested = payload && typeof payload.error === 'object' ? payload.error : {};
    throw new OwnerProspectingError(
      String(nested.code || payload.code || 'PROSPECTING_CONNECT_REQUEST_FAILED'),
      String(nested.message || payload.message || 'CONNECT rechazó la operación Prospecting.'),
      response.status,
      nested.details || payload.details || null
    );
  }

  return payload;
}

function sameMission(left, right) {
  return (
    normalize(left && left.mission) === normalize(right && right.mission) &&
    String((left && left.businessUnit) || 'ELANVISUAL').toUpperCase() === 'ELANVISUAL' &&
    left && left.mode === 'continuous' &&
    Number((left && left.targetCompanies) || 0) === Number((right && right.targetCompanies) || 0) &&
    ACTIVE_MISSION_STATUSES.has(String((left && left.status) || ''))
  );
}

function formatMission(mission, control, reused = false) {
  const supplierMission = isSupplierProspectingMission(mission && mission.mission);
  return [
    reused
      ? '♻️ Esa misión Prospecting ya estaba activa; no creé un duplicado.'
      : supplierMission
        ? '✅ Misión de búsqueda de proveedores creada.'
        : '✅ Misión Prospecting Autopilot creada.',
    '',
    'Objetivo: ' + Number(mission.targetCompanies || 0) + (supplierMission ? ' proveedores' : ' empresas'),
    'País: ' + (mission.country || 'Nicaragua'),
    'Modo: ' + (mission.mode === 'continuous' ? 'automático / reanudable' : (mission.mode || 'continuous')),
    'Estado: ' + (mission.status || 'draft'),
    'ID: ' + (mission.id || 'sin id'),
    '',
    'Investigación: ' + (control && control.researchEnabled === true ? 'ON' : 'OFF'),
    'Autopilot: ' + (control && control.autopilotEnabled === true ? 'ON' : 'OFF'),
    'Outreach: ' + (control && control.outreachEnabled === true ? 'ON' : 'OFF'),
    '',
    supplierMission
      ? 'ELAN investigará y registrará candidatos. Esta orden NO autoriza contacto ni promoción a proveedor oficial.'
      : 'ELAN continuará trabajando por lotes. No necesitás ejecutar la búsqueda empresa por empresa.'
  ].join('\n');
}

async function executeOwnerProspectingCommand(command, { requestImpl = requestProspecting } = {}) {
  if (!command || command.type !== COMMAND_TYPE) {
    return { handled: false, outputText: null, result: null };
  }

  const input = command.input || {};
  const control = await requestImpl('/api/v1/prospecting/control-status', { method: 'GET' });

  if (!control || control.researchEnabled !== true) {
    throw new OwnerProspectingError(
      'PROSPECTING_RESEARCH_DISABLED',
      'Prospecting Research está apagado. No creé la misión.',
      409
    );
  }

  if (control.autopilotEnabled !== true) {
    throw new OwnerProspectingError(
      'PROSPECTING_AUTOPILOT_DISABLED',
      'Prospecting Autopilot está apagado. No creé la misión.',
      409
    );
  }

  const existing = await requestImpl(
    '/api/v1/prospecting/missions?businessUnit=ELANVISUAL&limit=500',
    { method: 'GET' }
  );
  const rows = Array.isArray(existing) ? existing : [];
  const duplicate = rows.find(row => sameMission(row, input));

  if (duplicate) {
    return {
      handled: true,
      outputText: formatMission(duplicate, control, true),
      result: { mission: duplicate, control, reused: true }
    };
  }

  const mission = await requestImpl('/api/v1/prospecting/missions', {
    method: 'POST',
    body: {
      businessUnit: 'ELANVISUAL',
      mission: String(input.mission || '').trim(),
      mode: 'continuous',
      country: String(input.country || 'Nicaragua').trim(),
      targetCompanies: Math.max(1, Math.min(MAX_TARGET_COMPANIES, Number(input.targetCompanies || 20)))
    }
  });

  return {
    handled: true,
    outputText: formatMission(mission, control, false),
    result: { mission, control, reused: false }
  };
}

module.exports = {
  ACTIVE_MISSION_STATUSES,
  COMMAND_TYPE,
  MAX_TARGET_COMPANIES,
  SUPPLIER_MARKER,
  OwnerProspectingError,
  cleanMissionText,
  detectOwnerProspectingCommand,
  executeOwnerProspectingCommand,
  formatMission,
  isSupplierProspectingMission,
  requestProspecting,
  resolveInternalToken,
  sameMission,
  supplierMissionText
};
