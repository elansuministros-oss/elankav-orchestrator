'use strict';

const crypto = require('node:crypto');
const {
  getOperation: getStoredOperation,
  saveOperation,
  updateOperation
} = require('./ownerOpsLocalStore');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const OPERATION_TYPE = 'sensitive_operation';

function createOperationId(now = Date.now()) {
  return `OPS-${now}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function normalizeTtl(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_MS;
  return Math.min(parsed, 30 * 60 * 1000);
}

async function createPendingOperation({ capability, target, requestedBy = 'owner-whatsapp', summary, impact, parameters = {}, ttlMs = DEFAULT_TTL_MS }) {
  if (!capability || !target || !summary) throw new Error('OPERATION_INPUT_REQUIRED');
  const now = Date.now();
  const expiresAt = new Date(now + normalizeTtl(ttlMs)).toISOString();
  const operation = {
    id: createOperationId(now), type: OPERATION_TYPE, platform: 'elankav', task: summary,
    branch: null, status: 'pending', steps: [],
    result: { operation: { capability, target, requestedBy, impact: impact || 'Operación sensible.', parameters, state: 'awaiting_confirmation', expiresAt, confirmedAt: null, executedAt: null, execution: null } },
    error: null, createdAt: new Date(now).toISOString(), updatedAt: null, startedAt: null, finishedAt: null
  };
  return saveOperation(operation);
}

function getOperationData(job) {
  if (!job || job.type !== OPERATION_TYPE) return null;
  return job.result?.operation || null;
}

function isExpired(operation, now = Date.now()) {
  if (!operation?.expiresAt) return true;
  return new Date(operation.expiresAt).getTime() <= now;
}

async function loadPendingOperation(id, now = Date.now()) {
  const job = await getStoredOperation(id);
  const operation = getOperationData(job);
  if (!job || !operation) throw Object.assign(new Error('OPERATION_NOT_FOUND'), { code: 'OPERATION_NOT_FOUND' });
  if (job.status !== 'pending' || operation.state !== 'awaiting_confirmation') throw Object.assign(new Error('OPERATION_NOT_PENDING'), { code: 'OPERATION_NOT_PENDING' });
  if (isExpired(operation, now)) {
    await updateOperation(id, { status: 'failed', error: 'OPERATION_EXPIRED', finishedAt: new Date(now).toISOString(), result: { ...job.result, operation: { ...operation, state: 'expired' } } });
    throw Object.assign(new Error('OPERATION_EXPIRED'), { code: 'OPERATION_EXPIRED' });
  }
  return { job, operation };
}

async function markOperationRunning(id, now = Date.now()) {
  const { job, operation } = await loadPendingOperation(id, now);
  const confirmedAt = new Date(now).toISOString();
  return updateOperation(id, { status: 'running', startedAt: confirmedAt, result: { ...job.result, operation: { ...operation, state: 'confirmed', confirmedAt } } });
}

async function markOperationCompleted(id, execution, now = Date.now()) {
  const job = await getStoredOperation(id);
  const operation = getOperationData(job);
  if (!job || !operation) throw new Error('OPERATION_NOT_FOUND');
  const executedAt = new Date(now).toISOString();
  return updateOperation(id, { status: 'completed', error: null, finishedAt: executedAt, result: { ...job.result, operation: { ...operation, state: 'completed', executedAt, execution } } });
}

async function markOperationFailed(id, cause, now = Date.now()) {
  const job = await getStoredOperation(id);
  const operation = getOperationData(job);
  if (!job || !operation) throw cause;
  const finishedAt = new Date(now).toISOString();
  await updateOperation(id, { status: 'failed', error: cause?.code || cause?.message || 'OPERATION_FAILED', finishedAt, result: { ...job.result, operation: { ...operation, state: 'failed', executedAt: finishedAt } } });
  throw cause;
}

function formatPendingOperation(job) {
  const operation = getOperationData(job);
  if (!operation) return 'No fue posible preparar la operación.';
  return ['⚠️ Operación sensible preparada.', '', `Acción: ${job.task}`, `Objetivo: ${operation.target}`, `Impacto: ${operation.impact}`, `Operación: ${job.id}`, `Expira: ${operation.expiresAt}`, '', `Para ejecutar respondé exactamente: CONFIRMAR ${job.id}`].join('\n');
}

module.exports = { DEFAULT_TTL_MS, OPERATION_TYPE, createPendingOperation, formatPendingOperation, getOperationData, isExpired, loadPendingOperation, markOperationCompleted, markOperationFailed, markOperationRunning };
