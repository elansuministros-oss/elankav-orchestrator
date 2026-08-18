'use strict';

const crypto = require('node:crypto');
const { addJob, listJobs, updateJob } = require('./jobs/jobQueue');
const { normalizePhone } = require('../adapters/wahaDeliveryAdapter');
const { notifyOwner } = require('./ownerNotificationService');

const DELEGATION_TYPE = 'business_delegation';
const OPEN_STATUSES = new Set(['waiting_external', 'information_partial', 'decision_required']);
const DEFAULT_RESPONSE_TIMEOUT_MINUTES = 30;
const DEFAULT_MONITOR_INTERVAL_MS = 5 * 60 * 1000;
let monitor = null;

function clean(value) { return String(value || '').trim(); }
function normalize(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function addMinutes(date, minutes) { return new Date(new Date(date).getTime() + Number(minutes || 0) * 60000).toISOString(); }

function delegationFromJob(job) {
  return job?.type === DELEGATION_TYPE && job?.result?.delegation ? { job, ...job.result.delegation } : null;
}

async function createDelegation({
  kind,
  counterpartyName,
  phone,
  objective,
  requestedItems = null,
  relationshipType = null,
  source = 'owner-whatsapp',
  metadata = {},
  responseTimeoutMinutes = DEFAULT_RESPONSE_TIMEOUT_MINUTES,
  now = new Date().toISOString()
}) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw Object.assign(new Error('DELEGATION_PHONE_REQUIRED'), { code: 'DELEGATION_PHONE_REQUIRED' });
  const id = `DELEGATION-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const delegation = {
    id,
    kind: clean(kind) || 'external_request',
    counterpartyName: clean(counterpartyName) || `Contacto ${normalizedPhone.slice(-4)}`,
    phone: normalizedPhone,
    objective: clean(objective),
    requestedItems: requestedItems || null,
    relationshipType: clean(relationshipType) || null,
    source,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    openedAt: now,
    lastExternalAt: null,
    lastOwnerNotificationAt: null,
    reminderCount: 0,
    responseTimeoutMinutes: Math.max(5, Number(responseTimeoutMinutes) || DEFAULT_RESPONSE_TIMEOUT_MINUTES),
    nextCheckAt: addMinutes(now, Math.max(5, Number(responseTimeoutMinutes) || DEFAULT_RESPONSE_TIMEOUT_MINUTES)),
    observations: [],
    summary: null
  };
  const job = {
    id,
    type: DELEGATION_TYPE,
    platform: 'elankav',
    task: delegation.objective || `${delegation.kind}: ${delegation.counterpartyName}`,
    branch: null,
    status: 'waiting_external',
    steps: [],
    result: { delegation },
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null
  };
  return addJob(job);
}

async function findOpenDelegationByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  const jobs = await listJobs();
  return jobs
    .filter(job => job?.type === DELEGATION_TYPE && OPEN_STATUSES.has(job.status))
    .map(delegationFromJob)
    .find(item => item && normalizePhone(item.phone) === normalizedPhone) || null;
}

function classifyResponse(text, delegation = {}) {
  const value = normalize(text);
  const blocker = /\b(no tengo|no tenemos|no hay|agotad[oa]|sin existencia|no disponible|no manejamos|no trabajamos|no podemos|no se puede)\b/.test(value);
  const pricing = /(?:c\$|us\$|usd|nio|cordob|dolar|precio|cuesta|costo|cobra|tarifa|por m2|por m²|por metro|por proyecto|por jornada)/.test(value);
  const availability = /\b(disponible|existencia|entrega|listo|tiempo|dias|días|semana)\b/.test(value);
  const serviceInfo = /\b(servicio|hacemos|realizamos|instalamos|fabricamos|gypsum|densglass|acrilico|acrílico|pvc|impresion|impresión|rotulacion|rotulación)\b/.test(value);
  const coverage = /\b(managua|granada|leon|león|masaya|nicaragua|cobertura|departamento|zona|fuera de)\b/.test(value);
  const explicitComplete = /\b(cotizacion completa|cotización completa|eso seria todo|eso sería todo|estos son los precios|total es|total seria|total sería)\b/.test(value);
  const greetingOnly = /^(hola|buenos dias|buenos días|buenas tardes|buenas|que tal|qué tal)[!,. ]*$/.test(value);
  const aggregate = [
    ...(Array.isArray(delegation.observations) ? delegation.observations.map(item => clean(item?.text)) : []),
    clean(text)
  ].join(' ');
  const aggregateNormalized = normalize(aggregate);
  const candidateComplete = delegation.relationshipType === 'provider_candidate'
    && /\b(servicio|hacemos|realizamos|instalamos|fabricamos)\b/.test(aggregateNormalized)
    && /\b(precio|cobra|tarifa|por m2|por m²|por metro|por proyecto|por jornada)\b/.test(aggregateNormalized)
    && /\b(cobertura|managua|granada|leon|león|masaya|nicaragua|entrega|tiempo)\b/.test(aggregateNormalized);

  let classification = 'informational';
  let status = 'information_partial';
  if (blocker) { classification = 'blocker'; status = 'decision_required'; }
  else if (explicitComplete || candidateComplete) { classification = 'completed'; status = 'completed'; }
  else if (pricing || availability || serviceInfo || coverage) { classification = 'material_update'; status = 'information_partial'; }
  else if (greetingOnly) { classification = 'acknowledgement'; status = 'waiting_external'; }

  return { classification, status, blocker, pricing, availability, serviceInfo, coverage, greetingOnly };
}

function buildOwnerUpdate(delegation, text, classification) {
  const prefix = classification.classification === 'blocker'
    ? '⚠️ Encargo requiere decisión'
    : classification.classification === 'completed'
      ? '✅ Encargo completado'
      : classification.classification === 'acknowledgement'
        ? '📩 Respondieron al encargo'
        : '📩 Actualización de encargo';
  return [
    prefix,
    `Contacto: ${delegation.counterpartyName}`,
    delegation.objective ? `Objetivo: ${delegation.objective}` : '',
    '',
    `Respuesta: “${clean(text).slice(0, 1200)}”`,
    classification.classification === 'blocker' ? 'ELAN dejó el encargo abierto porque hace falta decidir cómo continuar.' : '',
    classification.classification === 'acknowledgement' ? 'Todavía no recibimos la información solicitada; ELAN seguirá esperando.' : ''
  ].filter(Boolean).join('\n');
}

async function handleDelegationInbound({ phone, text, occurredAt = new Date().toISOString() }, {
  notify = notifyOwner
} = {}) {
  const delegation = await findOpenDelegationByPhone(phone);
  if (!delegation) return null;
  const classification = classifyResponse(text, delegation);
  const observations = [
    ...(Array.isArray(delegation.observations) ? delegation.observations : []),
    { at: occurredAt, text: clean(text), classification: classification.classification }
  ].slice(-50);
  const updatedDelegation = {
    ...delegation,
    observations,
    lastExternalAt: occurredAt,
    nextCheckAt: classification.status === 'completed'
      ? null
      : addMinutes(occurredAt, delegation.responseTimeoutMinutes || DEFAULT_RESPONSE_TIMEOUT_MINUTES),
    summary: clean(text).slice(0, 2000)
  };
  delete updatedDelegation.job;

  const updated = await updateJob(delegation.id, {
    status: classification.status,
    result: { delegation: updatedDelegation },
    error: null,
    finishedAt: classification.status === 'completed' ? occurredAt : null
  });

  await notify(buildOwnerUpdate(updatedDelegation, text, classification));
  const notificationAt = new Date().toISOString();
  const finalDelegation = { ...updatedDelegation, lastOwnerNotificationAt: notificationAt };
  await updateJob(delegation.id, { result: { delegation: finalDelegation } });
  return { job: updated, delegation: finalDelegation, classification };
}

function buildTimeoutMessage(delegation) {
  return [
    '⏱️ Seguimiento pendiente',
    `Contacto: ${delegation.counterpartyName}`,
    delegation.objective ? `Encargo: ${delegation.objective}` : '',
    '',
    `No recibimos la información necesaria dentro de ${delegation.responseTimeoutMinutes || DEFAULT_RESPONSE_TIMEOUT_MINUTES} minutos.`,
    'El encargo sigue abierto. Podés indicarme que insista o que consulte otro proveedor.'
  ].filter(Boolean).join('\n');
}

async function sweepDelegations({ now = new Date(), notify = notifyOwner } = {}) {
  const jobs = await listJobs();
  const due = jobs
    .filter(job => job?.type === DELEGATION_TYPE && OPEN_STATUSES.has(job.status))
    .map(delegationFromJob)
    .filter(item => item?.nextCheckAt && new Date(item.nextCheckAt).getTime() <= now.getTime());

  for (const delegation of due) {
    await notify(buildTimeoutMessage(delegation));
    const reminderCount = Number(delegation.reminderCount || 0) + 1;
    const nextMinutes = reminderCount >= 2 ? 60 : delegation.responseTimeoutMinutes || DEFAULT_RESPONSE_TIMEOUT_MINUTES;
    const updatedDelegation = {
      ...delegation,
      reminderCount,
      lastOwnerNotificationAt: now.toISOString(),
      nextCheckAt: addMinutes(now.toISOString(), nextMinutes)
    };
    delete updatedDelegation.job;
    await updateJob(delegation.id, { result: { delegation: updatedDelegation } });
  }
  return due.length;
}

function startDelegationMonitor({ intervalMs = DEFAULT_MONITOR_INTERVAL_MS } = {}) {
  if (monitor) return monitor;
  monitor = setInterval(() => {
    sweepDelegations().catch(error => console.error('[BUSINESS_DELEGATION_SWEEP_FAILED]', { code: error?.code || null, message: error?.message || String(error) }));
  }, Math.max(60000, Number(intervalMs) || DEFAULT_MONITOR_INTERVAL_MS));
  monitor.unref?.();
  console.log('[BUSINESS_DELEGATION_MONITOR_STARTED]', { intervalMs: Math.max(60000, Number(intervalMs) || DEFAULT_MONITOR_INTERVAL_MS) });
  return monitor;
}

function stopDelegationMonitor() {
  if (!monitor) return false;
  clearInterval(monitor);
  monitor = null;
  return true;
}

module.exports = {
  DELEGATION_TYPE,
  OPEN_STATUSES,
  DEFAULT_RESPONSE_TIMEOUT_MINUTES,
  buildOwnerUpdate,
  buildTimeoutMessage,
  classifyResponse,
  createDelegation,
  findOpenDelegationByPhone,
  handleDelegationInbound,
  startDelegationMonitor,
  stopDelegationMonitor,
  sweepDelegations
};
