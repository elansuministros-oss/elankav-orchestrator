'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  getCapability,
  resolveService
} = require('./ownerOpsCapabilityRegistry');
const {
  loadPendingOperation,
  markOperationCompleted,
  markOperationFailed,
  markOperationRunning
} = require('./ownerOpsConfirmationService');
const {
  publishPreparedJob
} = require('./ownerOpsCodePublishService');

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 512 * 1024;

async function runCommand(file, args, options = {}) {
  const result = await execFileAsync(file, args, {
    env: process.env,
    timeout: options.timeout || 30_000,
    maxBuffer: MAX_BUFFER
  });

  return {
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  };
}

async function runPrivilegedSystemctl(args) {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  return isRoot
    ? runCommand('systemctl', args)
    : runCommand('sudo', ['-n', 'systemctl', ...args]);
}

async function restartService(target) {
  const service = resolveService(target);
  if (!service) {
    const error = new Error('OWNER_OPS_TARGET_NOT_ALLOWED');
    error.code = 'OWNER_OPS_TARGET_NOT_ALLOWED';
    throw error;
  }

  if (target === 'orchestrator') {
    const error = new Error('OWNER_OPS_SELF_RESTART_BLOCKED');
    error.code = 'OWNER_OPS_SELF_RESTART_BLOCKED';
    throw error;
  }

  await runPrivilegedSystemctl(['restart', service]);
  const status = await runCommand('systemctl', ['is-active', service]);

  if (status.stdout !== 'active') {
    const error = new Error('OWNER_OPS_SERVICE_NOT_ACTIVE_AFTER_RESTART');
    error.code = 'OWNER_OPS_SERVICE_NOT_ACTIVE_AFTER_RESTART';
    throw error;
  }

  return {
    capability: 'service.restart',
    target,
    service,
    status: status.stdout,
    success: true
  };
}

async function executeConfirmedOperation(id) {
  const { operation } = await loadPendingOperation(id);
  const capability = getCapability(operation.capability);

  if (!capability || capability.risk !== 'CONFIRM_REQUIRED') {
    const error = new Error('OWNER_OPS_CAPABILITY_NOT_CONFIRMABLE');
    error.code = 'OWNER_OPS_CAPABILITY_NOT_CONFIRMABLE';
    throw error;
  }

  await markOperationRunning(id);

  try {
    let execution;

    if (operation.capability === 'service.restart') {
      execution = await restartService(operation.target);
    } else if (operation.capability === 'git.publish-prepared') {
      const jobId = String(operation.parameters?.jobId || '').trim();
      if (!jobId) {
        const error = new Error('PREPARED_JOB_ID_REQUIRED');
        error.code = 'PREPARED_JOB_ID_REQUIRED';
        throw error;
      }
      execution = await publishPreparedJob(jobId);
    } else {
      const error = new Error('OWNER_OPS_SENSITIVE_CAPABILITY_NOT_IMPLEMENTED');
      error.code = 'OWNER_OPS_SENSITIVE_CAPABILITY_NOT_IMPLEMENTED';
      throw error;
    }

    const completed = await markOperationCompleted(id, execution);
    return {
      job: completed,
      execution
    };
  } catch (cause) {
    return markOperationFailed(id, cause);
  }
}

function formatSensitiveResult(result) {
  const execution = result?.execution;
  if (!execution) return 'La operación no devolvió resultado verificable.';

  if (execution.capability === 'service.restart') {
    return [
      '✅ Operación sensible completada.',
      '',
      `Operación: ${result.job.id}`,
      `Servicio: ${execution.service}`,
      `Estado verificado: ${execution.status}`
    ].join('\n');
  }

  if (execution.capability === 'git.publish-prepared') {
    return [
      '✅ Corrección preparada publicada.',
      '',
      `Operación: ${result.job.id}`,
      `Job preparado: ${execution.jobId}`,
      `Rama: ${execution.branch}`,
      `Commit: ${execution.commitSha || 'creado'}`,
      `Pull Request: ${execution.pullRequestUrl || 'creado'}`,
      '',
      'No se realizó merge ni deploy.'
    ].join('\n');
  }

  return `✅ Operación ${result.job.id} completada.`;
}

module.exports = {
  executeConfirmedOperation,
  formatSensitiveResult,
  restartService,
  runCommand,
  runPrivilegedSystemctl
};
