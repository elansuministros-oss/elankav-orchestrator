'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  getCapability,
  resolveRepository,
  resolveService
} = require('./ownerOpsCapabilityRegistry');

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 1024 * 1024;
const DEFAULT_LOG_LINES = 80;
const MAX_LOG_LINES = 300;
const SAFE_ENV_NAME_PATTERN = /^(OWNER|ORCHESTRATOR|WAHA|CONNECT|VQS|SUPABASE|GITHUB|OPENAI|CODEX|SERVICE|RUNTIME|QUOTE_CORE)/i;

function sanitizeOutput(value) {
  return String(value || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|service[_-]?role[_-]?key)\s*[:=]\s*)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^\s:@/]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .trim();
}

async function run(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: process.env,
    timeout: options.timeout || 15_000,
    maxBuffer: MAX_BUFFER,
    windowsHide: true
  });

  return {
    stdout: sanitizeOutput(stdout),
    stderr: sanitizeOutput(stderr)
  };
}

function assertReadCapability(id) {
  const capability = getCapability(id);
  if (!capability || capability.risk !== 'READ') {
    const error = new Error(`Capability no autorizada para ejecución directa: ${id}`);
    error.code = 'OWNER_OPS_CAPABILITY_DENIED';
    throw error;
  }
  return capability;
}

function clampLogLines(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LOG_LINES;
  return Math.min(Math.floor(parsed), MAX_LOG_LINES);
}

async function readServiceStatus(target) {
  assertReadCapability('service.status');
  const service = resolveService(target);
  if (!service) {
    const error = new Error('Servicio no autorizado.');
    error.code = 'OWNER_OPS_SERVICE_NOT_ALLOWED';
    throw error;
  }

  const active = await run('systemctl', ['is-active', service]).catch(error => ({
    stdout: sanitizeOutput(error.stdout || ''),
    stderr: sanitizeOutput(error.stderr || error.message || '')
  }));

  const show = await run('systemctl', [
    'show',
    service,
    '--property=ActiveState,SubState,MainPID,ExecMainStartTimestamp,MemoryCurrent',
    '--no-pager'
  ]);

  return {
    capability: 'service.status',
    target,
    service,
    active: active.stdout || 'unknown',
    details: show.stdout
  };
}

async function readServiceLogs(target, lines = DEFAULT_LOG_LINES) {
  assertReadCapability('service.logs');
  const service = resolveService(target);
  if (!service) {
    const error = new Error('Servicio no autorizado.');
    error.code = 'OWNER_OPS_SERVICE_NOT_ALLOWED';
    throw error;
  }

  const count = clampLogLines(lines);
  const result = await run('journalctl', [
    '-u', service,
    '-n', String(count),
    '--no-pager',
    '--output=short-iso'
  ], { timeout: 20_000 });

  return {
    capability: 'service.logs',
    target,
    service,
    lines: count,
    output: result.stdout
  };
}

async function readGitStatus(target) {
  assertReadCapability('git.status');
  const cwd = resolveRepository(target);
  if (!cwd) {
    const error = new Error('Repositorio no autorizado.');
    error.code = 'OWNER_OPS_REPOSITORY_NOT_ALLOWED';
    throw error;
  }

  const [branch, commit, status, diffStat] = await Promise.all([
    run('git', ['-C', cwd, 'branch', '--show-current']),
    run('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD']),
    run('git', ['-C', cwd, 'status', '--short']),
    run('git', ['-C', cwd, 'diff', '--stat'])
  ]);

  return {
    capability: 'git.status',
    target,
    cwd,
    branch: branch.stdout || 'unknown',
    commit: commit.stdout || 'unknown',
    clean: !status.stdout,
    status: status.stdout || 'clean',
    diffStat: diffStat.stdout || 'no local diff'
  };
}

async function readServerSummary() {
  assertReadCapability('server.summary');
  const [uptime, memory, disk, connect, orchestrator] = await Promise.all([
    run('uptime', ['-p']),
    run('free', ['-m']),
    run('df', ['-h', '/']),
    readServiceStatus('connect'),
    readServiceStatus('orchestrator')
  ]);

  return {
    capability: 'server.summary',
    uptime: uptime.stdout,
    memory: memory.stdout,
    disk: disk.stdout,
    services: {
      connect: connect.active,
      orchestrator: orchestrator.active
    }
  };
}

function readConfiguredEnvNames() {
  return Object.keys(process.env)
    .filter(name => SAFE_ENV_NAME_PATTERN.test(name))
    .sort();
}

async function readProductionAudit() {
  assertReadCapability('production.audit');
  const [server, connectGit, orchestratorGit, connectService, orchestratorService] = await Promise.all([
    readServerSummary(),
    readGitStatus('connect'),
    readGitStatus('orchestrator'),
    readServiceStatus('connect'),
    readServiceStatus('orchestrator')
  ]);

  return {
    capability: 'production.audit',
    server,
    git: {
      connect: connectGit,
      orchestrator: orchestratorGit
    },
    services: {
      connect: connectService,
      orchestrator: orchestratorService
    },
    configuredEnvNames: readConfiguredEnvNames(),
    secretsExposed: false
  };
}

function formatResult(result) {
  if (!result) return 'No fue posible obtener el resultado.';

  if (result.capability === 'production.audit') {
    return [
      'Auditoría integral READ-ONLY de producción completada.', '',
      'SERVICIOS',
      `CONNECT: ${result.services.connect.active}`,
      `ORCHESTRATOR: ${result.services.orchestrator.active}`, '',
      'GIT CONNECT',
      `Rama: ${result.git.connect.branch}`,
      `Commit: ${result.git.connect.commit}`,
      `Estado: ${result.git.connect.clean ? 'limpio' : 'con cambios locales'}`, '',
      'GIT ORCHESTRATOR',
      `Rama: ${result.git.orchestrator.branch}`,
      `Commit: ${result.git.orchestrator.commit}`,
      `Estado: ${result.git.orchestrator.clean ? 'limpio' : 'con cambios locales'}`, '',
      `Uptime: ${result.server.uptime || 'no disponible'}`,
      `Variables de configuración detectadas: ${result.configuredEnvNames.length}`,
      'Valores de secretos expuestos: NO', '',
      'No se realizaron cambios, reinicios, pull, push, merge ni deploy.'
    ].join('\n');
  }

  if (result.capability === 'server.summary') {
    return [
      'Auditoría READ-ONLY completada.', '',
      `CONNECT: ${result.services.connect}`,
      `ORCHESTRATOR: ${result.services.orchestrator}`,
      `Uptime: ${result.uptime || 'no disponible'}`, '',
      'MEMORIA', result.memory || 'no disponible', '',
      'DISCO /', result.disk || 'no disponible', '',
      'No se realizaron cambios.'
    ].join('\n');
  }

  if (result.capability === 'service.status') {
    return [
      `Estado ${result.target.toUpperCase()}: ${result.active}`,
      result.details || '',
      '',
      'Consulta READ-ONLY. No se realizaron cambios.'
    ].filter(Boolean).join('\n');
  }

  if (result.capability === 'service.logs') {
    return [
      `Logs recientes de ${result.target.toUpperCase()} (${result.lines} líneas):`, '',
      result.output || 'Sin salida.', '',
      'Consulta READ-ONLY. No se realizaron cambios.'
    ].join('\n');
  }

  if (result.capability === 'git.status') {
    return [
      `Repositorio ${result.target.toUpperCase()}`,
      `Rama: ${result.branch}`,
      `Commit: ${result.commit}`,
      `Estado: ${result.clean ? 'limpio' : 'con cambios locales'}`,
      result.clean ? '' : `Cambios:\n${result.status}`,
      result.diffStat && result.diffStat !== 'no local diff' ? `Diff stat:\n${result.diffStat}` : '',
      '',
      'Consulta READ-ONLY. No se realizaron cambios.'
    ].filter(Boolean).join('\n');
  }

  return JSON.stringify(result, null, 2);
}

async function executeReadOperation(command) {
  switch (command?.capability) {
    case 'production.audit':
      return readProductionAudit();
    case 'server.summary':
      return readServerSummary();
    case 'service.status':
      return readServiceStatus(command.target);
    case 'service.logs':
      return readServiceLogs(command.target, command.lines);
    case 'git.status':
      return readGitStatus(command.target);
    default: {
      const error = new Error('Operación Owner READ-ONLY no soportada.');
      error.code = 'OWNER_OPS_UNSUPPORTED';
      throw error;
    }
  }
}

module.exports = {
  executeReadOperation,
  formatResult,
  readConfiguredEnvNames,
  readGitStatus,
  readProductionAudit,
  readServerSummary,
  readServiceLogs,
  readServiceStatus,
  sanitizeOutput
};
