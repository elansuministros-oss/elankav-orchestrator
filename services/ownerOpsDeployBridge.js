'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_STORE_PATH = '/var/lib/elankav/orchestrator/owner-ops-operations.json';
const DEFAULT_SUPERVISOR_DIR = '/var/lib/elankav-owner-ops';
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const OPS_ID_PATTERN = /\bOPS-\d+-[A-Z0-9]{6}\b/i;
const COMMIT_PATTERN = /\b[0-9a-f]{40}\b/i;

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function getStorePath(env = process.env) {
  return String(env.OWNER_OPS_STORE_PATH || DEFAULT_STORE_PATH).trim() || DEFAULT_STORE_PATH;
}

function getSupervisorDir(env = process.env) {
  return String(env.OWNER_OPS_SUPERVISOR_DIR || DEFAULT_SUPERVISOR_DIR).trim() || DEFAULT_SUPERVISOR_DIR;
}

function resolveTarget(text) {
  if (/\b(connect|elankav connect)\b/.test(text)) return 'connect';
  if (/\b(orchestrator|orquestador)\b/.test(text)) return 'orchestrator';
  return null;
}

function canonicalBranch(target) {
  if (target === 'orchestrator') return 'orchestrator-next';
  if (target === 'connect') return 'main';
  return null;
}

function createOperationId(now = Date.now()) {
  return `OPS-${now}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicWriteJson(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await fs.rename(temp, file);
}

async function readStore(env = process.env) {
  const value = await readJson(getStorePath(env), {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function saveOperation(operation, env = process.env) {
  const store = await readStore(env);
  store[operation.id] = operation;
  await atomicWriteJson(getStorePath(env), store);
  return operation;
}

async function getOperation(id, env = process.env) {
  const store = await readStore(env);
  return store[id] || null;
}

function detectOwnerOpsDeployCommand(message) {
  const raw = String(message || '');
  const normalized = normalize(raw);
  const opsId = raw.toUpperCase().match(OPS_ID_PATTERN)?.[0] || null;

  if (opsId && /^confirmar\b/.test(normalized)) {
    return Object.freeze({ type: 'owner_ops_confirm', operationId: opsId });
  }

  if (opsId && /\b(estado|estatus|resultado|resultados|verifica|verificar|consulta|consultar)\b/.test(normalized)) {
    return Object.freeze({ type: 'owner_ops_status', operationId: opsId });
  }

  const target = resolveTarget(normalized);
  const commit = raw.match(COMMIT_PATTERN)?.[0]?.toLowerCase() || null;
  if (
    target &&
    commit &&
    /\b(despliega|desplegar|deploy|actualiza|actualizar)\b/.test(normalized)
  ) {
    return Object.freeze({
      type: 'owner_ops_prepare_deploy',
      target,
      commit
    });
  }

  return null;
}

async function prepareDeploy(command, env = process.env) {
  const target = command?.target;
  const commit = String(command?.commit || '').toLowerCase();
  if (!['connect', 'orchestrator'].includes(target) || !/^[0-9a-f]{40}$/.test(commit)) {
    const error = new Error('OWNER_OPS_DEPLOY_INPUT_INVALID');
    error.code = 'OWNER_OPS_DEPLOY_INPUT_INVALID';
    throw error;
  }

  const now = Date.now();
  const id = createOperationId(now);
  const operation = {
    id,
    type: 'sensitive_operation',
    platform: 'elankav',
    task: `Desplegar ${target === 'connect' ? 'CONNECT' : 'Orchestrator'} al commit ${commit.slice(0, 7)}`,
    branch: null,
    status: 'pending',
    steps: [],
    result: {
      operation: {
        capability: 'repository.deploy',
        target,
        requestedBy: 'owner-whatsapp',
        impact: 'Se exige repositorio limpio, fast-forward, commit remoto exacto, backup previo, instalación de dependencias y verificación del servicio.',
        parameters: {
          expectedCommit: commit,
          branch: canonicalBranch(target),
          deployStrategy: 'canonical-fast-forward',
          install: true,
          restart: true
        },
        state: 'awaiting_confirmation',
        expiresAt: new Date(now + DEFAULT_TTL_MS).toISOString(),
        confirmedAt: null,
        executedAt: null,
        execution: null
      }
    },
    error: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: null,
    startedAt: null,
    finishedAt: null
  };

  await saveOperation(operation, env);
  return {
    command: command.type,
    job: operation,
    outputText: [
      '⚠️ Operación sensible preparada.',
      '',
      `Acción: ${operation.task}`,
      `Objetivo: ${target}`,
      'Acción técnica: repository.deploy',
      `Commit: ${commit}`,
      `Operación: ${id}`,
      `Expira: ${operation.result.operation.expiresAt}`,
      '',
      `Para ejecutar respondé exactamente: CONFIRMAR ${id}`
    ].join('\n'),
    ownerOps: operation.result.operation
  };
}

async function confirmOperation(command, env = process.env) {
  const id = String(command?.operationId || '').toUpperCase();
  if (!OPS_ID_PATTERN.test(id)) throw Object.assign(new Error('OWNER_OPS_INVALID_OPERATION_ID'), { code: 'OWNER_OPS_INVALID_OPERATION_ID' });

  const operation = await getOperation(id, env);
  const data = operation?.result?.operation;
  if (!operation || !data) throw Object.assign(new Error('OPERATION_NOT_FOUND'), { code: 'OPERATION_NOT_FOUND' });
  if (operation.status !== 'pending' || data.state !== 'awaiting_confirmation') throw Object.assign(new Error('OPERATION_NOT_PENDING'), { code: 'OPERATION_NOT_PENDING' });
  if (new Date(data.expiresAt).getTime() <= Date.now()) {
    operation.status = 'failed';
    operation.error = 'OPERATION_EXPIRED';
    data.state = 'expired';
    operation.finishedAt = new Date().toISOString();
    await saveOperation(operation, env);
    throw Object.assign(new Error('OPERATION_EXPIRED'), { code: 'OPERATION_EXPIRED' });
  }

  const now = Date.now();
  const supervisorDir = getSupervisorDir(env);
  const requestDir = path.join(supervisorDir, 'requests');
  const resultDir = path.join(supervisorDir, 'results');
  await fs.mkdir(requestDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(resultDir, { recursive: true, mode: 0o700 });

  const request = {
    schemaVersion: 1,
    id,
    capability: data.capability,
    target: data.target,
    parameters: data.parameters || {},
    requestedAt: new Date(now).toISOString(),
    executeAfter: new Date(now + 2000).toISOString()
  };

  const requestFile = path.join(requestDir, `${id}.json`);
  const existing = await readJson(requestFile, null);
  if (!existing) await atomicWriteJson(requestFile, request);

  operation.status = 'running';
  operation.startedAt = new Date(now).toISOString();
  operation.updatedAt = operation.startedAt;
  data.state = 'confirmed';
  data.confirmedAt = operation.startedAt;
  await saveOperation(operation, env);

  return {
    command: command.type,
    job: operation,
    outputText: [
      '✅ Operación autorizada y delegada al supervisor externo.',
      '',
      `Operación: ${id}`,
      `Objetivo: ${data.target}`,
      `Acción: ${data.capability}`,
      `Ejecución programada: ${request.executeAfter}`,
      '',
      'El supervisor ejecutará la acción fuera del proceso del Orchestrator.',
      `Después podés consultar: ELAN estado ${id}`
    ].join('\n'),
    ownerOps: { capability: 'supervisor.delegated', delegatedCapability: data.capability, target: data.target, executeAfter: request.executeAfter, status: 'queued' }
  };
}

async function statusOperation(command, env = process.env) {
  const id = String(command?.operationId || '').toUpperCase();
  if (!OPS_ID_PATTERN.test(id)) throw Object.assign(new Error('OWNER_OPS_INVALID_OPERATION_ID'), { code: 'OWNER_OPS_INVALID_OPERATION_ID' });

  const operation = await getOperation(id, env);
  if (!operation) throw Object.assign(new Error('OPERATION_NOT_FOUND'), { code: 'OPERATION_NOT_FOUND' });

  const resultFile = path.join(getSupervisorDir(env), 'results', `${id}.json`);
  const result = await readJson(resultFile, null);
  if (!result) {
    return {
      command: command.type,
      job: operation,
      outputText: `Operación ${id} todavía pendiente en el supervisor externo.`,
      ownerOps: { id, status: 'pending', execution: null }
    };
  }

  if (result.status === 'completed') {
    const execution = result.execution || {};
    operation.status = 'completed';
    operation.error = null;
    operation.finishedAt = new Date().toISOString();
    operation.updatedAt = operation.finishedAt;
    operation.result.operation.state = 'completed';
    operation.result.operation.executedAt = operation.finishedAt;
    operation.result.operation.execution = execution;
    await saveOperation(operation, env);

    return {
      command: command.type,
      job: operation,
      outputText: [
        '✅ Resultado verificado del supervisor externo.',
        '',
        `Operación: ${id}`,
        `Acción: ${execution.capability || 'completada'}`,
        `Objetivo: ${execution.target || operation.result.operation.target}`,
        execution.after ? `Commit activo: ${execution.after}` : null,
        execution.backup ? `Backup: ${execution.backup}` : null,
        execution.service ? `Servicio: ${execution.service}` : null,
        execution.status ? `Estado: ${execution.status}` : null
      ].filter(Boolean).join('\n'),
      ownerOps: result
    };
  }

  operation.status = 'failed';
  operation.error = result.error || 'SUPERVISOR_OPERATION_FAILED';
  operation.finishedAt = new Date().toISOString();
  operation.updatedAt = operation.finishedAt;
  operation.result.operation.state = 'failed';
  operation.result.operation.executedAt = operation.finishedAt;
  await saveOperation(operation, env);

  const execution = result.execution && typeof result.execution === 'object'
    ? result.execution
    : {};
  const detail = result.detail || result.details || execution.detail || execution.details || null;
  const step = result.step || execution.step || null;
  const activeCommit = execution.after || execution.activeCommit || null;
  const branch = execution.branch || operation.result.operation.parameters?.branch || null;

  return {
    command: command.type,
    job: operation,
    outputText: [
      '❌ Operación del supervisor finalizada con error.',
      '',
      `Operación: ${id}`,
      `Error: ${operation.error}`,
      step ? `Paso: ${step}` : null,
      branch ? `Branch: ${branch}` : null,
      activeCommit ? `Commit observado: ${activeCommit}` : null,
      detail ? `Detalle: ${String(detail).slice(0, 1200)}` : null,
      'No se forzó ningún cambio fuera de la política permitida.'
    ].filter(Boolean).join('\n'),
    ownerOps: result
  };
}

async function executeOwnerOpsDeployCommand(command, env = process.env) {
  if (command?.type === 'owner_ops_prepare_deploy') return prepareDeploy(command, env);
  if (command?.type === 'owner_ops_confirm') return confirmOperation(command, env);
  if (command?.type === 'owner_ops_status') return statusOperation(command, env);
  throw Object.assign(new Error('OWNER_OPS_COMMAND_NOT_SUPPORTED'), { code: 'OWNER_OPS_COMMAND_NOT_SUPPORTED' });
}

module.exports = {
  DEFAULT_STORE_PATH,
  DEFAULT_SUPERVISOR_DIR,
  detectOwnerOpsDeployCommand,
  executeOwnerOpsDeployCommand,
  getOperation,
  getStorePath,
  getSupervisorDir,
  canonicalBranch,
  prepareDeploy,
  confirmOperation,
  statusOperation
};
