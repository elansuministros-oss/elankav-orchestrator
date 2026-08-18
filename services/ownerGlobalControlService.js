'use strict';

const crypto = require('node:crypto');
const { addJob, listJobs } = require('./jobs/jobQueue');

const CONTROL_TYPE = 'owner_response_control';
const MODE_OWNER_ONLY = 'owner_only';
const MODE_NORMAL = 'normal';

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parseOwnerResponseControlCommand(message) {
  const value = normalize(message).replace(/^elan[\s,;:.-]+/, '').trim();
  if (!value) return null;

  const disable = /(?:no respondas|no le respondas|deja de responder|no contestes|silencio).*(?:a nadie|clientes|proveedores|personas|contactos|todos)/.test(value)
    || /(?:solo|unicamente)\s+(?:respondeme|contesta(?:me)?|habla)\s+a\s+mi/.test(value)
    || /(?:modo\s+)?owner\s*only/.test(value);

  if (disable) return { enabled: true, mode: MODE_OWNER_ONLY };

  const enable = /(?:volvamos|vuelve|regresa).*(?:responder|contestar).*(?:normal|todos)/.test(value)
    || /(?:activa|activar|reanuda|reanudar|habilita|habilitar).*(?:respuestas|respuesta|atencion|atención)/.test(value)
    || /(?:responde|contesta)\s+(?:normalmente|a todos otra vez)/.test(value)
    || /(?:salir|desactiva|desactivar).*(?:owner\s*only|modo silencio)/.test(value);

  if (enable) return { enabled: false, mode: MODE_NORMAL };
  return null;
}

async function setOwnerOnlyMode(enabled, {
  source = 'owner-whatsapp',
  changedBy = 'owner'
} = {}) {
  const now = new Date().toISOString();
  const control = {
    enabled: Boolean(enabled),
    mode: enabled ? MODE_OWNER_ONLY : MODE_NORMAL,
    source,
    changedBy,
    changedAt: now
  };

  const job = {
    id: `CONTROL-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    type: CONTROL_TYPE,
    platform: 'elankav',
    task: enabled ? 'owner-only enabled' : 'owner-only disabled',
    branch: null,
    status: 'completed',
    steps: [],
    result: { control },
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now
  };

  await addJob(job);
  return control;
}

async function getOwnerResponseControl() {
  const jobs = await listJobs();
  const latest = jobs.find(job => job?.type === CONTROL_TYPE && job?.result?.control);
  return latest?.result?.control || {
    enabled: false,
    mode: MODE_NORMAL,
    source: 'default',
    changedBy: null,
    changedAt: null
  };
}

module.exports = {
  CONTROL_TYPE,
  MODE_NORMAL,
  MODE_OWNER_ONLY,
  getOwnerResponseControl,
  parseOwnerResponseControlCommand,
  setOwnerOnlyMode
};
