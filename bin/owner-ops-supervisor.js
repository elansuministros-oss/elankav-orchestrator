#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const BASE_DIR = process.env.OWNER_OPS_SUPERVISOR_DIR || '/var/lib/elankav-owner-ops';
const REQUEST_DIR = path.join(BASE_DIR, 'requests');
const RESULT_DIR = path.join(BASE_DIR, 'results');
const PROCESSING_DIR = path.join(BASE_DIR, 'processing');
const POLL_MS = Math.max(250, Number(process.env.OWNER_OPS_SUPERVISOR_POLL_MS) || 750);

const TARGETS = Object.freeze({
  connect: Object.freeze({
    service: 'elankav-connect.service',
    repo: '/opt/elankav/connect',
    branch: 'main'
  }),
  orchestrator: Object.freeze({
    service: 'elankav-orchestrator.service',
    repo: '/opt/elankav/orchestrator',
    branch: 'fix/AI-SALES-AUTONOMY-CONTEXT-INTEGRATED-01'
  })
});

function sanitizeTechnicalError(value) {
  return String(value || '')
    .replace(/https:\/\/[^@\s]+@/gi, 'https://***@')
    .replace(/\b(authorization|token|password|passwd|secret)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .trim()
    .slice(0, 1800);
}

async function run(file, args, options = {}) {
  try {
    const result = await execFileAsync(file, args, {
      cwd: options.cwd,
      env: process.env,
      timeout: options.timeout || 45_000,
      maxBuffer: 1024 * 1024
    });
    return {
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim()
    };
  } catch (cause) {
    const command = [file, ...args].join(' ');
    const stderr = sanitizeTechnicalError(cause?.stderr);
    const stdout = sanitizeTechnicalError(cause?.stdout);
    const detail = stderr || stdout || sanitizeTechnicalError(cause?.message) || `exit ${cause?.code || 'unknown'}`;
    const error = new Error(`${command}: ${detail}`);
    error.code = 'SUPERVISOR_COMMAND_FAILED';
    error.exitCode = cause?.code ?? null;
    throw error;
  }
}

async function ensureDirs() {
  for (const dir of [BASE_DIR, REQUEST_DIR, RESULT_DIR, PROCESSING_DIR]) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }
}

function assertRequest(request) {
  if (!request || request.schemaVersion !== 1) throw new Error('SUPERVISOR_INVALID_SCHEMA');
  if (!/^OPS-\d+-[A-Z0-9]{6}$/.test(String(request.id || ''))) throw new Error('SUPERVISOR_INVALID_ID');
  if (!['service.restart', 'repository.deploy'].includes(request.capability)) throw new Error('SUPERVISOR_CAPABILITY_DENIED');
  if (!TARGETS[request.target]) throw new Error('SUPERVISOR_TARGET_DENIED');
}

async function verifyService(target) {
  const config = TARGETS[target];
  const state = await run('systemctl', ['is-active', config.service]);
  return state.stdout;
}

async function restartService(target) {
  const config = TARGETS[target];
  await run('systemctl', ['restart', config.service], { timeout: 30_000 });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const state = await verifyService(target);
  if (state !== 'active') {
    const error = new Error('SUPERVISOR_SERVICE_NOT_ACTIVE');
    error.code = 'SUPERVISOR_SERVICE_NOT_ACTIVE';
    throw error;
  }
  return { capability: 'service.restart', target, service: config.service, status: state };
}

async function deployRepository(target, parameters = {}) {
  const config = TARGETS[target];
  const expectedCommit = String(parameters.expectedCommit || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    const error = new Error('SUPERVISOR_EXPECTED_COMMIT_REQUIRED');
    error.code = 'SUPERVISOR_EXPECTED_COMMIT_REQUIRED';
    throw error;
  }

  const branch = config.branch;
  const status = await run('git', ['-C', config.repo, 'status', '--porcelain', '--untracked-files=no']);
  if (status.stdout) {
    const error = new Error('SUPERVISOR_REPOSITORY_DIRTY');
    error.code = 'SUPERVISOR_REPOSITORY_DIRTY';
    throw error;
  }

  const currentBranch = await run('git', ['-C', config.repo, 'branch', '--show-current']);
  if (currentBranch.stdout !== branch) {
    const error = new Error('SUPERVISOR_BRANCH_MISMATCH');
    error.code = 'SUPERVISOR_BRANCH_MISMATCH';
    throw error;
  }

  const before = (await run('git', ['-C', config.repo, 'rev-parse', 'HEAD'])).stdout;
  await run('git', ['-C', config.repo, 'fetch', 'origin', branch], { timeout: 60_000 });
  const remote = (await run('git', ['-C', config.repo, 'rev-parse', `origin/${branch}`])).stdout.toLowerCase();
  if (remote !== expectedCommit) {
    const error = new Error('SUPERVISOR_REMOTE_COMMIT_MISMATCH');
    error.code = 'SUPERVISOR_REMOTE_COMMIT_MISMATCH';
    throw error;
  }

  try {
    await run('git', ['-C', config.repo, 'merge-base', '--is-ancestor', before, remote]);
  } catch {
    const error = new Error('SUPERVISOR_NON_FAST_FORWARD_DENIED');
    error.code = 'SUPERVISOR_NON_FAST_FORWARD_DENIED';
    throw error;
  }

  const backup = `backup/owner-ops-${Date.now()}`;
  await run('git', ['-C', config.repo, 'branch', backup, before]);
  await run('git', ['-C', config.repo, 'merge', '--ff-only', `origin/${branch}`], { timeout: 60_000 });

  if (parameters.install === true) {
    await run('npm', ['install'], { cwd: config.repo, timeout: 180_000 });
  }

  if (parameters.restart !== false) {
    await restartService(target);
  }

  const after = (await run('git', ['-C', config.repo, 'rev-parse', 'HEAD'])).stdout;
  const serviceStatus = parameters.restart === false ? await verifyService(target) : 'active';
  return {
    capability: 'repository.deploy',
    target,
    branch,
    before,
    after,
    backup,
    service: config.service,
    status: serviceStatus
  };
}

async function executeRequest(request) {
  assertRequest(request);
  if (request.executeAfter) {
    const waitMs = new Date(request.executeAfter).getTime() - Date.now();
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 10_000)));
  }

  if (request.capability === 'service.restart') return restartService(request.target);
  if (request.capability === 'repository.deploy') return deployRepository(request.target, request.parameters || {});
  throw new Error('SUPERVISOR_CAPABILITY_NOT_IMPLEMENTED');
}

async function writeResult(id, payload) {
  const finalPath = path.join(RESULT_DIR, `${id}.json`);
  const tempPath = `${finalPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await fs.rename(tempPath, finalPath);
}

async function processFile(fileName) {
  if (!/^OPS-\d+-[A-Z0-9]{6}\.json$/.test(fileName)) return;
  const source = path.join(REQUEST_DIR, fileName);
  const processing = path.join(PROCESSING_DIR, fileName);
  try {
    await fs.rename(source, processing);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  let request;
  try {
    request = JSON.parse(await fs.readFile(processing, 'utf8'));
    const execution = await executeRequest(request);
    await writeResult(request.id, {
      id: request.id,
      status: 'completed',
      execution,
      completedAt: new Date().toISOString()
    });
  } catch (error) {
    const id = request?.id || fileName.replace(/\.json$/, '');
    await writeResult(id, {
      id,
      status: 'failed',
      error: sanitizeTechnicalError(error.message) || String(error.code || 'SUPERVISOR_OPERATION_FAILED'),
      errorCode: String(error.code || 'SUPERVISOR_OPERATION_FAILED'),
      exitCode: error.exitCode ?? null,
      completedAt: new Date().toISOString()
    }).catch(() => {});
  } finally {
    await fs.unlink(processing).catch(() => {});
  }
}

async function tick() {
  await ensureDirs();
  const files = await fs.readdir(REQUEST_DIR);
  for (const file of files.sort()) await processFile(file);
}

async function main() {
  await ensureDirs();
  console.log('[OWNER_OPS_SUPERVISOR] READY');
  for (;;) {
    try {
      await tick();
    } catch (error) {
      console.error('[OWNER_OPS_SUPERVISOR_ERROR]', error.code || error.message);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('[OWNER_OPS_SUPERVISOR_FATAL]', error.code || error.message);
    process.exit(1);
  });
}

module.exports = {
  TARGETS,
  assertRequest,
  deployRepository,
  executeRequest,
  restartService,
  sanitizeTechnicalError
};
