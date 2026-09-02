'use strict';

const { createHmac } = require('node:crypto');

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const MIN_TARGET = 1;
const MAX_TARGET = 500;
const DEFAULT_TARGET = 200;

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function connectBaseUrl(env = process.env) {
  return String(
    env.ELANKAV_CONNECT_URL ||
    env.CONNECT_API_URL ||
    DEFAULT_CONNECT_URL
  ).trim().replace(/\/+$/, '');
}

function connectInternalToken(env = process.env) {
  const explicit = String(
    env.CONNECT_INTERNAL_API_TOKEN ||
    env.CONNECT_INTERNAL_TOKEN ||
    env.ELANKAV_CONNECT_INTERNAL_TOKEN ||
    ''
  ).trim();
  if (explicit) return explicit;

  const root = String(env.VQS_API_TOKEN || '').trim();
  if (!root) return '';
  return createHmac('sha256', root)
    .update('ELANKAV_CHANNEL_INTERNAL_V1')
    .digest('hex');
}

function parseTargetCount(message) {
  const normalized = normalizeText(message);
  const direct = normalized.match(/\b(\d{1,4})\s+(?:proveedores|proveedor|aliados|suplidores)\b/);
  const fallback = normalized.match(/\b(?:proveedores|proveedor|aliados|suplidores)\D{0,20}(\d{1,4})\b/);
  const raw = Number((direct || fallback)?.[1] || DEFAULT_TARGET);
  return Math.max(MIN_TARGET, Math.min(MAX_TARGET, Number.isFinite(raw) ? raw : DEFAULT_TARGET));
}

function isSupplierProspectingRequest(message) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  const supplier = /\b(proveedor|proveedores|suplidor|suplidores|aliado|aliados)\b/.test(normalized);
  const discovery = /\b(busca|buscar|buscame|investiga|investigar|encuentra|encontrar|localiza|localizar|prospecta|prospectar|descubre|descubrir)\b/.test(normalized);
  return supplier && discovery;
}

function buildSupplierMission(message, targetCount) {
  const original = String(message || '').trim();
  return [
    '[SUPPLIER_PROSPECTING]',
    `Objetivo: descubrir y validar hasta ${targetCount} prospectos de proveedores para la red global ELAN, priorizando ELANVISUAL.`,
    'País inicial: Nicaragua. Cubrir territorialmente departamentos y ciudades; registrar ciudad, departamento, dirección pública y cobertura cuando la fuente lo permita.',
    'Priorizar proveedores relacionados con PVC, ACM, acrílico, vinil, impresión gran formato, impresión UV, serigrafía, sublimación, rótulos, letras corpóreas, cajas de luz, LED, CNC/router, corte láser, metalmecánica, soldadura, instalación, transporte de carga, grúas, andamios, material POP, impresión textil y acabados gráficos.',
    'Investigar qué venden, fabrican o ejecutan, ubicación, cobertura, web/redes y contactos comerciales públicos. No contactar a nadie durante esta misión.',
    'No promover candidatos a la base oficial de proveedores. Esta misión solo descubre y califica candidatos en Prospecting.',
    original ? `Orden Owner: ${original}` : ''
  ].filter(Boolean).join(' ');
}

function createError(code, status, message) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

async function connectJson(path, { method = 'GET', body, fetchImpl = fetch, env = process.env } = {}) {
  const token = connectInternalToken(env);
  if (!token) throw createError('CONNECT_INTERNAL_TOKEN_REQUIRED', 503, 'Falta token interno para CONNECT.');

  const response = await fetchImpl(`${connectBaseUrl(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(Number(env.CONNECT_PROSPECTING_TIMEOUT_MS || 120_000))
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createError(
      payload?.error?.code || 'CONNECT_PROSPECTING_REQUEST_FAILED',
      response.status,
      payload?.error?.message || `CONNECT HTTP ${response.status}`
    );
  }
  return payload;
}

async function startSupplierProspectingMission({ message, fetchImpl = fetch, env = process.env }) {
  const targetCount = parseTargetCount(message);
  const missionText = buildSupplierMission(message, targetCount);

  const control = await connectJson('/api/v1/prospecting/control-status', { fetchImpl, env });
  if (control?.researchEnabled !== true) {
    throw createError('PROSPECTING_RESEARCH_DISABLED', 409, 'La investigación de Prospecting está desactivada en CONNECT.');
  }

  const mission = await connectJson('/api/v1/prospecting/missions', {
    method: 'POST',
    body: {
      businessUnit: 'ELANVISUAL',
      mission: missionText,
      mode: 'continuous',
      country: 'Nicaragua',
      targetCompanies: targetCount
    },
    fetchImpl,
    env
  });

  const run = await connectJson(`/api/v1/prospecting/missions/${encodeURIComponent(mission.id)}/run`, {
    method: 'POST',
    fetchImpl,
    env
  });

  const current = run?.mission || mission;
  return {
    mission: current,
    firstRun: run,
    control: {
      researchEnabled: control?.researchEnabled === true,
      autopilotEnabled: control?.autopilotEnabled === true,
      outreachEnabled: control?.outreachEnabled === true,
      outreachAutopilotEnabled: control?.outreachAutopilotEnabled === true,
      emailOutreachEnabled: control?.emailOutreachEnabled === true,
      whatsappOutreachEnabled: control?.whatsappOutreachEnabled === true
    }
  };
}

function formatSupplierMissionStarted(result) {
  const mission = result?.mission || {};
  const control = result?.control || {};
  const continuation = control.autopilotEnabled
    ? 'La misión quedó en modo continuo y CONNECT seguirá retomándola automáticamente hasta completar el objetivo o quedar sin nuevos resultados.'
    : 'La misión quedó creada y ejecutó el primer ciclo, pero el Autopilot de investigación está apagado; no asumiré que continuará sola.';
  return [
    '✅ Búsqueda de proveedores iniciada.',
    '',
    `Misión: ${mission.id || 'sin id'}`,
    `Objetivo: ${mission.targetCompanies ?? 'no disponible'} proveedores`,
    `Encontrados hasta ahora: ${mission.companiesFound ?? 0}`,
    `Estado: ${mission.status || 'no disponible'}`,
    'Alcance: Nicaragua · red global ELAN · prioridad ELANVISUAL',
    'Contacto automático: NO',
    `Outreach general: ${control.outreachEnabled ? 'ENCENDIDO' : 'APAGADO'}`,
    `WhatsApp Outreach: ${control.whatsappOutreachEnabled ? 'ENCENDIDO' : 'APAGADO'}`,
    `Email Outreach: ${control.emailOutreachEnabled ? 'ENCENDIDO' : 'APAGADO'}`,
    '',
    continuation
  ].join('\n');
}

module.exports = {
  DEFAULT_TARGET,
  MAX_TARGET,
  buildSupplierMission,
  connectBaseUrl,
  connectInternalToken,
  formatSupplierMissionStarted,
  isSupplierProspectingRequest,
  parseTargetCount,
  startSupplierProspectingMission
};
