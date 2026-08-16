'use strict';

const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  getCapability,
  resolveRepository,
  resolveService
} = require('./ownerOpsCapabilityRegistry');
const {
  recordAuditSafely
} = require('./ownerOpsAuditService');

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 1024 * 1024;
const DEFAULT_LOG_LINES = 80;
const MAX_LOG_LINES = 300;
const SAFE_ENV_NAME_PATTERN = /^(OWNER|ORCHESTRATOR|WAHA|CONNECT|VQS|SUPABASE|GITHUB|OPENAI|CODEX|SERVICE|RUNTIME|QUOTE_CORE)/i;
const MAX_FILE_BYTES = 64 * 1024;

const FILE_SPECS = Object.freeze({
  'owner-language-profile': Object.freeze({
    path: '/var/lib/elankav/orchestrator/owner-language-profile.json',
    label: 'Owner Language Profile'
  }),
  'owner-language-profile.json': Object.freeze({
    path: '/var/lib/elankav/orchestrator/owner-language-profile.json',
    label: 'Owner Language Profile'
  }),
  'orchestrator-owner-command': Object.freeze({
    path: '/opt/elankav/orchestrator/services/ownerCommandService.js',
    label: 'Orchestrator ownerCommandService.js'
  }),
  'orchestrator-message-service': Object.freeze({
    path: '/opt/elankav/orchestrator/services/messageService.js',
    label: 'Orchestrator messageService.js'
  }),
  'orchestrator-owner-ops-read': Object.freeze({
    path: '/opt/elankav/orchestrator/services/ownerOpsReadService.js',
    label: 'Orchestrator ownerOpsReadService.js'
  }),
  'orchestrator-owner-ops-registry': Object.freeze({
    path: '/opt/elankav/orchestrator/services/ownerOpsCapabilityRegistry.js',
    label: 'Orchestrator ownerOpsCapabilityRegistry.js'
  })
});

const TEST_SUITES = Object.freeze({
  'orchestrator-owner-language': Object.freeze({
    target: 'orchestrator',
    cwd: '/opt/elankav/orchestrator',
    file: 'tests/ownerLanguageProfile.test.js',
    label: 'Owner Language'
  }),
  'orchestrator-owner-business': Object.freeze({
    target: 'orchestrator',
    cwd: '/opt/elankav/orchestrator',
    file: 'tests/ownerBusinessModesPricingLogistics.test.js',
    label: 'Owner Business'
  }),
  'orchestrator-owner-ops': Object.freeze({
    target: 'orchestrator',
    cwd: '/opt/elankav/orchestrator',
    file: 'tests/ownerOpsReadService.test.js',
    label: 'Owner OPS'
  })
});

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
    env: options.env || process.env,
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

function resolveFileSpec(alias) {
  return FILE_SPECS[String(alias || '').trim().toLowerCase()] || null;
}

function resolveTestSuite(suite) {
  return TEST_SUITES[String(suite || '').trim().toLowerCase()] || null;
}

async function readFileInspect(alias) {
  assertReadCapability('file.inspect');

  const spec = resolveFileSpec(alias);

  if (!spec) {
    const error = new Error('Archivo no autorizado.');
    error.code = 'OWNER_OPS_FILE_NOT_ALLOWED';
    throw error;
  }

  let stat;

  try {
    stat = await fs.stat(spec.path);
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      const error = new Error('Archivo autorizado todavía no existe.');
      error.code = 'OWNER_OPS_FILE_NOT_FOUND';
      throw error;
    }
    throw cause;
  }

  if (!stat.isFile()) {
    const error = new Error('La ruta autorizada no es un archivo.');
    error.code = 'OWNER_OPS_FILE_INVALID';
    throw error;
  }

  if (stat.size > MAX_FILE_BYTES) {
    const error = new Error('Archivo demasiado grande para consulta por WhatsApp.');
    error.code = 'OWNER_OPS_FILE_TOO_LARGE';
    throw error;
  }

  const content = sanitizeOutput(
    await fs.readFile(spec.path, 'utf8')
  );

  return {
    capability: 'file.inspect',
    alias,
    label: spec.label,
    path: spec.path,
    size: stat.size,
    content
  };
}

async function runTestSuite(suite) {
  assertReadCapability('test.run');

  const spec = resolveTestSuite(suite);

  if (!spec) {
    const error = new Error('Suite de pruebas no autorizada.');
    error.code = 'OWNER_OPS_TEST_NOT_ALLOWED';
    throw error;
  }

  const testEnv = { ...process.env };

  for (const name of Object.keys(testEnv)) {
    if (
      name === 'NODE_TEST_CONTEXT' ||
      name.startsWith('NODE_TEST_')
    ) {
      delete testEnv[name];
    }
  }

  const result = await run(
    process.execPath,
    ['--test', spec.file],
    {
      cwd: spec.cwd,
      timeout: 60_000,
      env: testEnv
    }
  );

  return {
    capability: 'test.run',
    suite,
    target: spec.target,
    label: spec.label,
    file: spec.file,
    success: true,
    output: [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
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

  if (result.capability === 'file.inspect') {
    return [
      `Archivo: ${result.label}`,
      `Ruta autorizada: ${result.path}`,
      `Tamaño: ${result.size} bytes`,
      '',
      result.content || 'Archivo vacío.',
      '',
      'Consulta READ-ONLY. No se realizaron cambios.'
    ].join('\n');
  }

  if (result.capability === 'test.run') {
    return [
      `Suite: ${result.label}`,
      `Archivo: ${result.file}`,
      `Resultado: ${result.success ? 'PASS' : 'FAIL'}`,
      '',
      result.output || 'Sin salida.',
      '',
      'Ejecución controlada. No se aceptó ningún comando shell arbitrario.'
    ].join('\n');
  }

  return JSON.stringify(result, null, 2);
}

async function executeReadOperation(command) {
  const capability = command?.capability || null;
  const target = command?.target || null;

  try {
    let result;
    switch (capability) {
      case 'production.audit':
        result = await readProductionAudit();
        break;
      case 'server.summary':
        result = await readServerSummary();
        break;
      case 'service.status':
        result = await readServiceStatus(target);
        break;
      case 'service.logs':
        result = await readServiceLogs(target, command.lines);
        break;
      case 'git.status':
        result = await readGitStatus(target);
        break;
      case 'file.inspect':
        result = await readFileInspect(command.fileAlias);
        break;
      case 'test.run':
        result = await runTestSuite(command.suite);
        break;
      default: {
        const error = new Error('Operación Owner READ-ONLY no soportada.');
        error.code = 'OWNER_OPS_UNSUPPORTED';
        throw error;
      }
    }

    await recordAuditSafely({
      capability,
      target,
      success: true,
      metadata:
        capability === 'service.logs'
          ? { lines: result.lines }
          : capability === 'file.inspect'
            ? { alias: result.alias, size: result.size }
            : capability === 'test.run'
              ? { suite: result.suite, success: result.success }
              : {}
    });

    return result;
  } catch (error) {
    await recordAuditSafely({
      capability,
      target,
      success: false,
      errorCode: error?.code || 'OWNER_OPS_READ_FAILED'
    });
    throw error;
  }
}

module.exports = {
  executeReadOperation,
  formatResult,
  readFileInspect,
  runTestSuite,
  resolveFileSpec,
  resolveTestSuite,
  readConfiguredEnvNames,
  readGitStatus,
  readProductionAudit,
  readServerSummary,
  readServiceLogs,
  readServiceStatus,
  sanitizeOutput
};
