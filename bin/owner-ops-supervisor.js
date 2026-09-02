#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  scheduleSupervisorRefresh
} = require('../deploy/schedule-owner-ops-supervisor-refresh');
const {
  getProtectedComponentsForTarget
} = require('../services/protectedComponentRegistry');
const {
  getProtectedContractSpec,
  resolveVitestBinary
} = require('../services/protectedComponentContracts');

const execFileAsync = promisify(execFile);
const BASE_DIR = process.env.OWNER_OPS_SUPERVISOR_DIR || '/var/lib/elankav-owner-ops';
const REQUEST_DIR = path.join(BASE_DIR, 'requests');
const RESULT_DIR = path.join(BASE_DIR, 'results');
const PROCESSING_DIR = path.join(BASE_DIR, 'processing');
const BACKUP_DIR = path.join(BASE_DIR, 'backups');
const POLL_MS = Math.max(250, Number(process.env.OWNER_OPS_SUPERVISOR_POLL_MS) || 750);
const GENERATED_CONNECT_CATALOG = 'data/elanvisual-commercial-catalog-2026-08-16.tsv';
const WHATSAPP_CORE_PROTECTED = String(process.env.WHATSAPP_CORE_PROTECTED || 'true').trim().toLowerCase() !== 'false';
const WHATSAPP_CORE_WATCHDOG_MS = Math.max(15_000, Number(process.env.WHATSAPP_CORE_WATCHDOG_MS) || 60_000);
const WHATSAPP_CORE_STATE_PATH = path.join(BASE_DIR, 'whatsapp-core-state.json');
const PROTECTED_COMPONENT_STATE_PATH = path.join(BASE_DIR, 'protected-components-state.json');
let nextWhatsappCoreWatchdogAt = 0;
const WHATSAPP_CORE_CONTRACT_LINES = Object.freeze(["const assert=require('node:assert/strict');","const {EventEmitter}=require('node:events');","const api=require('./api/wahaWebhookApi');","function req(body){const r=new EventEmitter();r.method='POST';r.url='/webhook/inbound';r.headers={host:'localhost'};r.destroy=()=>{};process.nextTick(()=>{r.emit('data',Buffer.from(JSON.stringify(body)));r.emit('end')});return r}","function res(){return{setHeader(){}}}","async function runCase(body,mode){api.clearWahaInboundDedupe();const json=[];const sent=[];let decisions=0,processes=0;await api.handleWahaWebhookApi({req:req(body),res:res(),sendJson(_r,status,payload){json.push({status,payload})},dependencies:{async requestConversationDecision(){decisions++;if(mode==='customer')return{action:'NO_REPLY',reason:'contract_customer_gate'};throw new Error('OWNER_MUST_NOT_USE_CUSTOMER_GATE')},async processMessage(){processes++;if(mode==='owner-failure'){const e=new Error('SIMULATED_OWNER_RUNTIME_FAILURE');e.code='SIMULATED_OWNER_RUNTIME_FAILURE';throw e}if(mode==='customer')throw new Error('CUSTOMER_GATE_MUST_SUPPRESS_PROCESSING');return{reply:'WHATSAPP_CORE_CONTRACT_REPLY',model:'contract',context:{ownerMode:true,platform:'elanvisual'}}},async sendWahaText(input){sent.push(input);return{id:'contract-message'}},async persistConversationEvent(){return{ok:true}}}});assert.equal(json.length,1);return{response:json[0],sent,decisions,processes}}","(async()=>{","let x=await runCase({event:'message',id:'contract-owner-phone',session:'ELANKAV',payload:{from:'50588388940@c.us',body:'HOLA',fromMe:false}},'owner');assert.equal(x.response.payload.replySent,true);assert.equal(x.response.payload.ownerMode,true);assert.equal(x.decisions,0);assert.equal(x.processes,1);","x=await runCase({event:'message',id:'contract-owner-web',session:'ELANKAV',payload:{from:'215440458567779@lid',body:'HOLA DESDE WEB',fromMe:false,key:{remoteJidAlt:'50512345678@c.us'}}},'owner');assert.equal(x.response.payload.replySent,true);assert.equal(x.response.payload.ownerMode,true);assert.equal(x.decisions,0);assert.equal(x.processes,1);assert.equal(x.sent[0].chatId,'215440458567779@lid');","x=await runCase({event:'message',id:'contract-owner-fallback',session:'ELANKAV',payload:{from:'215440458567779@lid',body:'FALLA',fromMe:false,key:{remoteJidAlt:'50512345678@c.us'}}},'owner-failure');assert.equal(x.response.payload.replySent,true);assert.equal(x.response.payload.fallbackSent,true);assert.equal(x.response.payload.ownerMode,true);","x=await runCase({event:'message',id:'contract-customer',session:'ELANKAV',payload:{from:'50577777777@c.us',body:'HOLA',fromMe:false}},'customer');assert.equal(x.decisions,1);assert.equal(x.processes,0);assert.equal(x.response.payload.replySent,false);assert.equal(x.response.payload.suppressed,true);","process.stdout.write('WHATSAPP_CORE_CONTRACT_OK\\n')","})().catch(e=>{console.error('WHATSAPP_CORE_CONTRACT_FAILED',e&&e.stack||e);process.exit(1)});"]);

const TARGETS = Object.freeze({
  connect: Object.freeze({
    service: 'elankav-connect.service',
    repo: '/opt/elankav/connect',
    branch: 'main',
    installMode: 'ci-dev',
    build: true,
    port: 4400
  }),
  orchestrator: Object.freeze({
    service: 'elankav-orchestrator.service',
    repo: '/opt/elankav/orchestrator',
    branch: 'stable/ORCHESTRATOR-WHATSAPP-CORE',
    installMode: 'install',
    build: false,
    port: null
  }),
  langflow: Object.freeze({
    service: 'docker:elankav-langflow',
    repo: '/opt/elankav/orchestrator',
    branch: 'stable/ORCHESTRATOR-WHATSAPP-CORE',
    installMode: null,
    build: false,
    port: 7860,
    deployMode: 'docker-compose'
  })
});

const LANGFLOW_STATE_DIR = process.env.LANGFLOW_STATE_DIR || '/var/lib/elankav-langflow';
const LANGFLOW_ENV_PATH = path.join(LANGFLOW_STATE_DIR, 'langflow.env');
const LANGFLOW_DATA_DIR = path.join(LANGFLOW_STATE_DIR, 'data');
const LANGFLOW_COMPOSE_PATH = path.join(TARGETS.orchestrator.repo, 'deploy/langflow/docker-compose.yml');


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
    const stdoutRaw = String(result.stdout || '');
    const stderrRaw = String(result.stderr || '');
    return {
      stdout: stdoutRaw.trim(),
      stderr: stderrRaw.trim(),
      stdoutRaw,
      stderrRaw
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

async function runWhatsappCoreContract(repo) {
  if (!WHATSAPP_CORE_PROTECTED) return 'WHATSAPP_CORE_PROTECTION_DISABLED';
  const result = await run('node', ['-e', WHATSAPP_CORE_CONTRACT_LINES.join('\n')], {
    cwd: repo,
    timeout: 60_000
  });
  if (!result.stdout.includes('WHATSAPP_CORE_CONTRACT_OK')) {
    const error = new Error('WHATSAPP_CORE_CONTRACT_FAILED');
    error.code = 'WHATSAPP_CORE_CONTRACT_FAILED';
    throw error;
  }
  return 'WHATSAPP_CORE_CONTRACT_OK';
}

async function runProtectedComponentContract(component, repo) {
  const spec = getProtectedContractSpec(component.contract);
  let result = '';

  if (spec.kind === 'builtin' && component.contract === 'owner_whatsapp_core') {
    result = await runWhatsappCoreContract(repo);
  } else if (spec.kind === 'node_test') {
    const execution = await run('node', ['--test', ...spec.files], {
      cwd: repo,
      timeout: 180_000
    });
    result = execution.stdout || `${spec.label}_OK`;
  } else if (spec.kind === 'vitest') {
    const execution = await run(resolveVitestBinary(repo), ['run', ...spec.files], {
      cwd: repo,
      timeout: 240_000
    });
    result = execution.stdout || `${spec.label}_OK`;
  } else if (spec.kind === 'source_contract') {
    const scriptPath = path.join(TARGETS.orchestrator.repo, spec.script);
    const execution = await run('node', [scriptPath, ...spec.args, repo], {
      cwd: TARGETS.orchestrator.repo,
      timeout: 60_000
    });
    result = execution.stdout || `${spec.label}_OK`;
  } else {
    const error = new Error('PROTECTED_COMPONENT_RUNNER_DENIED');
    error.code = 'PROTECTED_COMPONENT_RUNNER_DENIED';
    throw error;
  }

  return {
    id: component.id,
    contract: component.contract,
    critical: component.critical !== false,
    status: 'passed',
    result: sanitizeTechnicalError(result).slice(0, 1200)
  };
}

async function runProtectedComponentContracts(target, repo) {
  const components = getProtectedComponentsForTarget(target);
  if (!components.length) {
    const error = new Error('PROTECTED_COMPONENTS_NOT_REGISTERED');
    error.code = 'PROTECTED_COMPONENTS_NOT_REGISTERED';
    throw error;
  }

  const results = [];
  for (const component of components) {
    try {
      results.push(await runProtectedComponentContract(component, repo));
    } catch (cause) {
      const error = new Error(`PROTECTED_COMPONENT_CONTRACT_FAILED:${component.id}:${cause?.code || cause?.message || 'UNKNOWN'}`);
      error.code = 'PROTECTED_COMPONENT_CONTRACT_FAILED';
      error.componentId = component.id;
      error.cause = cause;
      throw error;
    }
  }
  return results;
}

async function readProtectedComponentState() {
  try {
    const raw = await fs.readFile(PROTECTED_COMPONENT_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { version: 1, components: {} };
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, components: {} };
    throw error;
  }
}

async function writeProtectedComponentState(state) {
  await ensureDirs();
  const payload = {
    version: 1,
    components: state?.components && typeof state.components === 'object'
      ? state.components
      : {},
    updatedAt: new Date().toISOString()
  };
  const tempPath = `${PROTECTED_COMPONENT_STATE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, PROTECTED_COMPONENT_STATE_PATH);
  return payload;
}

async function markProtectedComponentsGood({ target, sha, contracts, source = 'supervisor_deploy' }) {
  const current = await readProtectedComponentState();
  const components = { ...(current.components || {}) };
  for (const contract of contracts || []) {
    components[contract.id] = {
      target,
      lastGoodSha: sha,
      contract: contract.contract,
      status: 'passed',
      source,
      verifiedAt: new Date().toISOString()
    };
  }
  return writeProtectedComponentState({ components });
}

async function verifyOrchestratorHttpHealth() {
  const urls = ['http://127.0.0.1:4100/health', 'http://172.19.0.1:4100/health'];
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.status === 'OK') return url;
      lastError = new Error('ORCHESTRATOR_HEALTH_INVALID');
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error(lastError?.message || 'SUPERVISOR_ORCHESTRATOR_HEALTH_FAILED');
  error.code = 'SUPERVISOR_ORCHESTRATOR_HEALTH_FAILED';
  throw error;
}

async function verifyWhatsappBridgeHealth() {
  const urls = ['http://127.0.0.1:4100/webhook/inbound', 'http://172.19.0.1:4100/webhook/inbound'];
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.status === 'READY') return url;
      lastError = new Error('WHATSAPP_BRIDGE_HEALTH_INVALID');
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error(lastError?.message || 'SUPERVISOR_WHATSAPP_BRIDGE_HEALTH_FAILED');
  error.code = 'SUPERVISOR_WHATSAPP_BRIDGE_HEALTH_FAILED';
  throw error;
}

async function restoreOrchestratorBaseline(config, before) {
  await run('git', ['-C', config.repo, 'reset', '--hard', before], { timeout: 60_000 });
  await installDependencies(config);
  await restartService('orchestrator');
  await verifyOrchestratorHttpHealth();
  await verifyWhatsappBridgeHealth();
  return before;
}

async function restoreConnectBaseline(config, before) {
  await run('git', ['-C', config.repo, 'reset', '--hard', before], { timeout: 60_000 });
  await installDependencies(config);
  await buildRepository(config);
  await restartService('connect');
  return before;
}

async function readWhatsappCoreState() {
  try {
    const raw = await fs.readFile(WHATSAPP_CORE_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeWhatsappCoreState(state) {
  await ensureDirs();
  const payload = {
    version: 1,
    ...state,
    updatedAt: new Date().toISOString()
  };
  const tempPath = `${WHATSAPP_CORE_STATE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, WHATSAPP_CORE_STATE_PATH);
  return payload;
}

async function readOrchestratorRepoState() {
  const config = TARGETS.orchestrator;
  const [sha, branch, status] = await Promise.all([
    run('git', ['-C', config.repo, 'rev-parse', 'HEAD']),
    run('git', ['-C', config.repo, 'branch', '--show-current']),
    run('git', ['-C', config.repo, 'status', '--porcelain', '--untracked-files=no'])
  ]);
  return {
    sha: sha.stdout,
    branch: branch.stdout,
    dirty: porcelainEntries(status.stdoutRaw).length > 0,
    status: status.stdoutRaw
  };
}

async function captureWhatsappCoreDrift(repoState, baseline, reason) {
  await ensureDirs();
  const stamp = Date.now();
  let diffStat = '';
  try {
    diffStat = (await run('git', ['-C', TARGETS.orchestrator.repo, 'diff', '--stat'], { timeout: 15_000 })).stdout;
  } catch (_) {}
  const evidence = {
    detectedAt: new Date().toISOString(),
    reason: String(reason || 'WHATSAPP_CORE_DRIFT'),
    current: repoState,
    baseline,
    diffStat
  };
  const filePath = path.join(BACKUP_DIR, `whatsapp-core-drift-${stamp}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return filePath;
}

async function markWhatsappCoreGood({ source = 'supervisor' } = {}) {
  const repoState = await readOrchestratorRepoState();
  if (repoState.branch !== TARGETS.orchestrator.branch || repoState.dirty) {
    const error = new Error('WHATSAPP_CORE_BASELINE_NOT_CLEAN');
    error.code = 'WHATSAPP_CORE_BASELINE_NOT_CLEAN';
    throw error;
  }
  return writeWhatsappCoreState({
    lastGoodSha: repoState.sha,
    branch: repoState.branch,
    source,
    contract: 'WHATSAPP_CORE_CONTRACT_OK',
    health: 'OK',
    bridge: 'READY'
  });
}

async function restoreWhatsappCoreLastGood(reason = 'WHATSAPP_CORE_DRIFT') {
  const config = TARGETS.orchestrator;
  const baseline = await readWhatsappCoreState();
  if (!baseline || !/^[0-9a-f]{40}$/i.test(String(baseline.lastGoodSha || ''))) {
    const error = new Error('WHATSAPP_CORE_LAST_GOOD_MISSING');
    error.code = 'WHATSAPP_CORE_LAST_GOOD_MISSING';
    throw error;
  }

  const repoState = await readOrchestratorRepoState();
  const evidencePath = await captureWhatsappCoreDrift(repoState, baseline, reason);
  const backupBranch = `backup/whatsapp-core-watchdog-${Date.now()}`;

  try {
    await run('git', ['-C', config.repo, 'branch', backupBranch, repoState.sha], { timeout: 30_000 });
  } catch (_) {}

  await run('git', ['-C', config.repo, 'reset', '--hard'], { timeout: 30_000 });
  await run('git', ['-C', config.repo, 'switch', '-C', config.branch, baseline.lastGoodSha], { timeout: 60_000 });
  await installDependencies(config);
  await runWhatsappCoreContract(config.repo);
  await restartService('orchestrator');
  const healthEndpoint = await verifyOrchestratorHttpHealth();
  const bridgeEndpoint = await verifyWhatsappBridgeHealth();

  await writeWhatsappCoreState({
    ...baseline,
    lastRecoveryAt: new Date().toISOString(),
    lastRecoveryReason: String(reason || 'WHATSAPP_CORE_DRIFT'),
    lastRecoveryEvidence: evidencePath,
    healthEndpoint,
    bridgeEndpoint,
    source: 'watchdog_recovery'
  });

  console.error('[WHATSAPP_CORE_AUTO_ROLLBACK]', {
    reason: String(reason || 'WHATSAPP_CORE_DRIFT'),
    restoredSha: baseline.lastGoodSha,
    evidencePath
  });

  return {
    status: 'rolled_back',
    restoredSha: baseline.lastGoodSha,
    evidencePath,
    healthEndpoint,
    bridgeEndpoint
  };
}

async function runWhatsappCoreWatchdog({ force = false, allowBootstrap = false } = {}) {
  if (!WHATSAPP_CORE_PROTECTED) return { status: 'disabled' };

  const now = Date.now();
  if (!force && now < nextWhatsappCoreWatchdogAt) return { status: 'not_due' };
  nextWhatsappCoreWatchdogAt = now + WHATSAPP_CORE_WATCHDOG_MS;

  const repoState = await readOrchestratorRepoState();
  const baseline = await readWhatsappCoreState();

  if (!baseline) {
    if (!allowBootstrap) {
      const error = new Error('WHATSAPP_CORE_BASELINE_NOT_INITIALIZED');
      error.code = 'WHATSAPP_CORE_BASELINE_NOT_INITIALIZED';
      throw error;
    }
    if (repoState.branch !== TARGETS.orchestrator.branch || repoState.dirty) {
      const error = new Error('WHATSAPP_CORE_BOOTSTRAP_REPOSITORY_INVALID');
      error.code = 'WHATSAPP_CORE_BOOTSTRAP_REPOSITORY_INVALID';
      throw error;
    }
    await runWhatsappCoreContract(TARGETS.orchestrator.repo);
    const healthEndpoint = await verifyOrchestratorHttpHealth();
    const bridgeEndpoint = await verifyWhatsappBridgeHealth();
    const stored = await writeWhatsappCoreState({
      lastGoodSha: repoState.sha,
      branch: repoState.branch,
      source: 'watchdog_bootstrap',
      contract: 'WHATSAPP_CORE_CONTRACT_OK',
      health: 'OK',
      bridge: 'READY',
      healthEndpoint,
      bridgeEndpoint
    });
    return { status: 'bootstrapped', state: stored };
  }

  const drift =
    repoState.branch !== TARGETS.orchestrator.branch ||
    repoState.sha !== baseline.lastGoodSha ||
    repoState.dirty;

  if (drift) {
    return restoreWhatsappCoreLastGood('WHATSAPP_CORE_UNAUTHORIZED_DRIFT');
  }

  try {
    await runWhatsappCoreContract(TARGETS.orchestrator.repo);
    const healthEndpoint = await verifyOrchestratorHttpHealth();
    const bridgeEndpoint = await verifyWhatsappBridgeHealth();
    return { status: 'healthy', sha: repoState.sha, healthEndpoint, bridgeEndpoint };
  } catch (error) {
    return restoreWhatsappCoreLastGood(error?.code || error?.message || 'WHATSAPP_CORE_HEALTH_FAILURE');
  }
}

async function ensureDirs() {
  for (const dir of [BASE_DIR, REQUEST_DIR, RESULT_DIR, PROCESSING_DIR, BACKUP_DIR]) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }
}

async function recoverInterruptedOperations() {
  await ensureDirs();
  const files = await fs.readdir(PROCESSING_DIR);
  let recovered = 0;

  for (const fileName of files.sort()) {
    if (!/^OPS-\d+-[A-Z0-9]{6}\.json$/.test(fileName)) continue;

    const processingPath = path.join(PROCESSING_DIR, fileName);
    const requestPath = path.join(REQUEST_DIR, fileName);
    const resultPath = path.join(RESULT_DIR, fileName);

    try {
      await fs.access(resultPath);
      await fs.unlink(processingPath).catch(() => {});
      continue;
    } catch (_) {}

    try {
      await fs.access(requestPath);
      await fs.unlink(processingPath).catch(() => {});
      continue;
    } catch (_) {}

    await fs.rename(processingPath, requestPath);
    recovered += 1;
  }

  return recovered;
}

function assertRequest(request) {
  if (!request || request.schemaVersion !== 1) throw new Error('SUPERVISOR_INVALID_SCHEMA');
  if (!/^OPS-\d+-[A-Z0-9]{6}$/.test(String(request.id || ''))) throw new Error('SUPERVISOR_INVALID_ID');
  if (!['service.restart', 'repository.deploy'].includes(request.capability)) throw new Error('SUPERVISOR_CAPABILITY_DENIED');
  if (!TARGETS[request.target]) throw new Error('SUPERVISOR_TARGET_DENIED');
}

async function verifyLangflowHttpHealth(timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch('http://127.0.0.1:7860/health_check', {
        signal: AbortSignal.timeout(5_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (
        response.ok &&
        payload?.status === 'ok' &&
        payload?.chat === 'ok' &&
        payload?.db === 'ok'
      ) {
        return 'http://127.0.0.1:7860/health_check';
      }
      lastError = new Error('LANGFLOW_HEALTH_INVALID');
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  const error = new Error(lastError?.message || 'LANGFLOW_HEALTH_FAILED');
  error.code = 'LANGFLOW_HEALTH_FAILED';
  throw error;
}

async function readMemAvailableMb() {
  const raw = await fs.readFile('/proc/meminfo', 'utf8');
  const match = raw.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  if (!match) return null;
  return Math.floor(Number(match[1]) / 1024);
}

async function verifyLangflowHostPreflight() {
  await run('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 15_000 });
  await run('docker', ['compose', 'version'], { timeout: 15_000 });
  const memoryAvailableMb = await readMemAvailableMb();
  if (Number.isFinite(memoryAvailableMb) && memoryAvailableMb < 900) {
    const error = new Error(`LANGFLOW_HOST_MEMORY_LOW:${memoryAvailableMb}MB`);
    error.code = 'LANGFLOW_HOST_MEMORY_LOW';
    throw error;
  }
  const disk = await run('df', ['-Pk', LANGFLOW_STATE_DIR], { timeout: 15_000 }).catch(async () => {
    await fs.mkdir(LANGFLOW_STATE_DIR, { recursive: true, mode: 0o700 });
    return run('df', ['-Pk', LANGFLOW_STATE_DIR], { timeout: 15_000 });
  });
  const lines = disk.stdoutRaw.trim().split('\n');
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  const availableKb = Number(cols[3]);
  if (Number.isFinite(availableKb) && availableKb < 2 * 1024 * 1024) {
    const error = new Error('LANGFLOW_HOST_DISK_LOW');
    error.code = 'LANGFLOW_HOST_DISK_LOW';
    throw error;
  }
  return { memoryAvailableMb, diskAvailableKb: availableKb };
}

function makeLangflowSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

async function ensureLangflowRuntimeEnv() {
  await fs.mkdir(LANGFLOW_STATE_DIR, { recursive: true, mode: 0o700 });
  await fs.mkdir(LANGFLOW_DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    const current = await fs.readFile(LANGFLOW_ENV_PATH, 'utf8');
    if (
      /LANGFLOW_SUPERUSER_PASSWORD=\S+/.test(current) &&
      /LANGFLOW_SECRET_KEY=\S+/.test(current) &&
      /LANGFLOW_API_KEY=\S+/.test(current)
    ) {
      return { created: false, path: LANGFLOW_ENV_PATH };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const payload = [
    'LANGFLOW_SUPERUSER=elan-admin',
    `LANGFLOW_SUPERUSER_PASSWORD=${makeLangflowSecret(24)}`,
    `LANGFLOW_SECRET_KEY=${makeLangflowSecret(32)}`,
    'LANGFLOW_API_KEY_SOURCE=env',
    `LANGFLOW_API_KEY=${makeLangflowSecret(32)}`,
    'LANGFLOW_AUTO_LOGIN=false',
    'LANGFLOW_ENABLE_SIGNUP=false',
    'LANGFLOW_ENABLE_SUPERUSER_CLI=false',
    ''
  ].join('\n');
  const tempPath = `${LANGFLOW_ENV_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, payload, { mode: 0o600 });
  await fs.rename(tempPath, LANGFLOW_ENV_PATH);
  await fs.chmod(LANGFLOW_ENV_PATH, 0o600);
  return { created: true, path: LANGFLOW_ENV_PATH };
}

async function deployLangflowComponent() {
  const preflight = await verifyLangflowHostPreflight();
  const runtimeEnv = await ensureLangflowRuntimeEnv();
  await run('docker', ['compose', '-f', LANGFLOW_COMPOSE_PATH, 'pull', 'langflow'], {
    cwd: TARGETS.orchestrator.repo,
    timeout: 300_000
  });
  await run('docker', ['compose', '-f', LANGFLOW_COMPOSE_PATH, 'up', '-d', '--remove-orphans', 'langflow'], {
    cwd: TARGETS.orchestrator.repo,
    timeout: 180_000
  });
  const healthEndpoint = await verifyLangflowHttpHealth();
  const listening = await verifyPort(7860, 30_000);
  return {
    capability: 'service.restart',
    target: 'langflow',
    service: TARGETS.langflow.service,
    status: 'active',
    listening,
    healthEndpoint,
    runtimeEnvCreated: runtimeEnv.created,
    runtimeEnvPath: runtimeEnv.path,
    preflight
  };
}

async function verifyService(target) {
  const config = TARGETS[target];
  if (config?.deployMode === 'docker-compose') {
    const state = await run('docker', ['inspect', '-f', '{{.State.Running}}', 'elankav-langflow'], { timeout: 15_000 });
    return state.stdout === 'true' ? 'active' : 'inactive';
  }
  const state = await run('systemctl', ['is-active', config.service]);
  return state.stdout;
}

async function verifyPort(port, timeoutMs = 8_000) {
  if (!port) return null;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const listening = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const finish = value => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(800);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });

    if (listening) return `127.0.0.1:${port}`;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const error = new Error(`SUPERVISOR_PORT_NOT_LISTENING:${port}`);
  error.code = 'SUPERVISOR_PORT_NOT_LISTENING';
  throw error;
}

async function restartService(target) {
  const config = TARGETS[target];
  if (config?.deployMode === 'docker-compose') return deployLangflowComponent();
  await run('systemctl', ['restart', config.service], { timeout: 30_000 });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const state = await verifyService(target);
  if (state !== 'active') {
    const error = new Error('SUPERVISOR_SERVICE_NOT_ACTIVE');
    error.code = 'SUPERVISOR_SERVICE_NOT_ACTIVE';
    throw error;
  }
  const listening = await verifyPort(config.port);
  return {
    capability: 'service.restart',
    target,
    service: config.service,
    status: state,
    listening
  };
}

async function installDependencies(config) {
  if (config.installMode === 'ci-dev') {
    await run('npm', ['ci', '--include=dev'], { cwd: config.repo, timeout: 240_000 });
    return 'npm ci --include=dev';
  }

  await run('npm', ['install'], { cwd: config.repo, timeout: 240_000 });
  return 'npm install';
}

async function buildRepository(config) {
  if (!config.build) return null;
  await run('npm', ['run', 'build'], { cwd: config.repo, timeout: 240_000 });
  return 'npm run build';
}

function porcelainEntry(line) {
  const raw = String(line || '').replace(/\r$/, '');
  if (raw.length < 4 || raw[2] !== ' ') return null;
  const status = raw.slice(0, 2);
  const filePath = raw.slice(3);
  return {
    raw,
    status,
    path: filePath,
    isRenameOrCopy: status.includes('R') || status.includes('C')
  };
}

function porcelainEntries(rawOutput) {
  return String(rawOutput || '')
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.length > 0)
    .map(porcelainEntry);
}

function porcelainPath(line) {
  return porcelainEntry(line)?.path || '';
}

async function cleanGeneratedConnectCatalog(config) {
  const status = await run('git', ['-C', config.repo, 'status', '--porcelain', '--untracked-files=no']);
  const entries = porcelainEntries(status.stdoutRaw);
  const allowedStatuses = new Set([' M', 'M ', 'MM']);
  const expected = entries.length === 1
    && entries[0]
    && !entries[0].isRenameOrCopy
    && allowedStatuses.has(entries[0].status)
    && entries[0].path === GENERATED_CONNECT_CATALOG;

  if (!expected) {
    const summary = entries
      .map(entry => entry ? `${entry.status}:${entry.path}` : 'INVALID_PORCELAIN_LINE')
      .join('|') || 'EMPTY';
    const error = new Error(`SUPERVISOR_CLEAN_SCOPE_MISMATCH:${summary}`);
    error.code = 'SUPERVISOR_CLEAN_SCOPE_MISMATCH';
    throw error;
  }

  const source = path.join(config.repo, GENERATED_CONNECT_CATALOG);
  const backupName = `connect-generated-catalog-${Date.now()}.tsv`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  await fs.copyFile(source, backupPath);
  await fs.chmod(backupPath, 0o600);
  await run('git', ['-C', config.repo, 'restore', '--source=HEAD', '--staged', '--worktree', '--', GENERATED_CONNECT_CATALOG]);
  const after = await run('git', ['-C', config.repo, 'status', '--porcelain', '--untracked-files=no']);
  if (porcelainEntries(after.stdoutRaw).length > 0) {
    const error = new Error('SUPERVISOR_REPOSITORY_STILL_DIRTY_AFTER_CLEAN');
    error.code = 'SUPERVISOR_REPOSITORY_STILL_DIRTY_AFTER_CLEAN';
    throw error;
  }
  return backupPath;
}

function isRecoverableDetachedConnectBranch(target, currentBranch) {
  return target === 'connect' && !String(currentBranch || '').trim();
}

async function deployRepository(target, parameters = {}) {
  const config = TARGETS[target];
  const expectedCommit = String(parameters.expectedCommit || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    const error = new Error('SUPERVISOR_EXPECTED_COMMIT_REQUIRED');
    error.code = 'SUPERVISOR_EXPECTED_COMMIT_REQUIRED';
    throw error;
  }

  let cleanupBackup = null;
  if (parameters.cleanGeneratedCatalog === true) {
    if (target !== 'connect') {
      const error = new Error('SUPERVISOR_CLEAN_TARGET_DENIED');
      error.code = 'SUPERVISOR_CLEAN_TARGET_DENIED';
      throw error;
    }
    cleanupBackup = await cleanGeneratedConnectCatalog(config);
  }

  const branch = config.branch;
  const status = await run('git', ['-C', config.repo, 'status', '--porcelain', '--untracked-files=no']);
  if (porcelainEntries(status.stdoutRaw).length > 0) {
    const error = new Error('SUPERVISOR_REPOSITORY_DIRTY');
    error.code = 'SUPERVISOR_REPOSITORY_DIRTY';
    throw error;
  }

  await run('git', ['-C', config.repo, 'fetch', 'origin', branch], { timeout: 60_000 });
  const remote = (await run('git', ['-C', config.repo, 'rev-parse', `origin/${branch}`])).stdout.toLowerCase();

  let currentBranch = await run('git', ['-C', config.repo, 'branch', '--show-current']);
  if (currentBranch.stdout !== branch) {
    const detachedHead = (await run('git', ['-C', config.repo, 'rev-parse', 'HEAD'])).stdout;

    if (isRecoverableDetachedConnectBranch(target, currentBranch.stdout)) {
      try {
        await run('git', ['-C', config.repo, 'merge-base', '--is-ancestor', detachedHead, remote]);
      } catch {
        const error = new Error('SUPERVISOR_CONNECT_DETACHED_NON_FAST_FORWARD_DENIED');
        error.code = 'SUPERVISOR_CONNECT_DETACHED_NON_FAST_FORWARD_DENIED';
        throw error;
      }

      try {
        await run('git', ['-C', config.repo, 'switch', branch], { timeout: 30_000 });
      } catch {
        await run('git', ['-C', config.repo, 'switch', '-c', branch, detachedHead], { timeout: 30_000 });
      }

      currentBranch = await run('git', ['-C', config.repo, 'branch', '--show-current']);
    }

    if (currentBranch.stdout !== branch) {
      const error = new Error('SUPERVISOR_BRANCH_MISMATCH');
      error.code = 'SUPERVISOR_BRANCH_MISMATCH';
      throw error;
    }
  }

  const before = (await run('git', ['-C', config.repo, 'rev-parse', 'HEAD'])).stdout;

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

  let merged = false;
  let installCommand = null;
  let buildCommand = null;
  let whatsappCoreContract = null;
  let protectedContracts = [];
  let healthEndpoint = null;
  let bridgeEndpoint = null;

  try {
    await run('git', ['-C', config.repo, 'merge', '--ff-only', `origin/${branch}`], { timeout: 60_000 });
    merged = true;

    if (target === 'connect' || parameters.install === true) {
      installCommand = await installDependencies(config);
    }

    if (config.build) {
      buildCommand = await buildRepository(config);
    }

    protectedContracts = await runProtectedComponentContracts(target, config.repo);
    const whatsappResult = protectedContracts.find(item => item.id === 'OWNER_WHATSAPP_CORE');
    whatsappCoreContract = whatsappResult?.result?.includes('WHATSAPP_CORE_CONTRACT_OK')
      ? 'WHATSAPP_CORE_CONTRACT_OK'
      : (target === 'orchestrator' && WHATSAPP_CORE_PROTECTED ? null : null);

    let restart = null;
    if (parameters.restart !== false) {
      restart = await restartService(target);
    }

    if (target === 'orchestrator' && WHATSAPP_CORE_PROTECTED) {
      healthEndpoint = await verifyOrchestratorHttpHealth();
      bridgeEndpoint = await verifyWhatsappBridgeHealth();
    }

    const after = (await run('git', ['-C', config.repo, 'rev-parse', 'HEAD'])).stdout;
    const serviceStatus = restart?.status || await verifyService(target);
    const listening = restart?.listening || await verifyPort(config.port);

    if (target === 'orchestrator' && WHATSAPP_CORE_PROTECTED) {
      await markWhatsappCoreGood({ source: 'supervisor_deploy' });
    }

    await markProtectedComponentsGood({
      target,
      sha: after,
      contracts: protectedContracts,
      source: 'supervisor_deploy'
    });

    return {
      capability: 'repository.deploy',
      target,
      branch,
      before,
      after,
      backup,
      cleanedGeneratedCatalog: Boolean(cleanupBackup),
      cleanupBackup,
      installCommand,
      buildCommand,
      service: config.service,
      status: serviceStatus,
      listening,
      whatsappCoreProtected: target === 'orchestrator' ? WHATSAPP_CORE_PROTECTED : null,
      whatsappCoreContract,
      protectedComponents: protectedContracts.map(item => ({
        id: item.id,
        contract: item.contract,
        status: item.status
      })),
      healthEndpoint,
      bridgeEndpoint
    };
  } catch (cause) {
    if (merged && target === 'orchestrator' && WHATSAPP_CORE_PROTECTED) {
      try {
        await restoreOrchestratorBaseline(config, before);
        cause.message = `${cause.message || cause.code || 'ORCHESTRATOR_DEPLOY_FAILED'};PROTECTED_COMPONENT_ROLLBACK_OK`;
      } catch (rollbackError) {
        cause.message = `${cause.message || cause.code || 'ORCHESTRATOR_DEPLOY_FAILED'};PROTECTED_COMPONENT_ROLLBACK_FAILED:${sanitizeTechnicalError(rollbackError.message || rollbackError.code)}`;
        cause.code = 'SUPERVISOR_PROTECTED_COMPONENT_ROLLBACK_FAILED';
      }
    } else if (merged && target === 'connect') {
      try {
        await restoreConnectBaseline(config, before);
        cause.message = `${cause.message || cause.code || 'CONNECT_DEPLOY_FAILED'};PROTECTED_COMPONENT_ROLLBACK_OK`;
      } catch (rollbackError) {
        cause.message = `${cause.message || cause.code || 'CONNECT_DEPLOY_FAILED'};PROTECTED_COMPONENT_ROLLBACK_FAILED:${sanitizeTechnicalError(rollbackError.message || rollbackError.code)}`;
        cause.code = 'SUPERVISOR_PROTECTED_COMPONENT_ROLLBACK_FAILED';
      }
    } else if (target === 'langflow') {
      cause.message = `${cause.message || cause.code || 'LANGFLOW_DEPLOY_FAILED'};ORCHESTRATOR_UNCHANGED`;
    }
    throw cause;
  }
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

function shouldRefreshSupervisorAfterRequest(request) {
  return request?.capability === 'repository.deploy'
    && request?.target === 'orchestrator';
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
  let refreshSupervisor = false;
  try {
    request = JSON.parse(await fs.readFile(processing, 'utf8'));
    const execution = await executeRequest(request);
    refreshSupervisor = shouldRefreshSupervisorAfterRequest(request);
    await writeResult(request.id, {
      id: request.id,
      status: 'completed',
      execution,
      supervisorRefreshScheduled: refreshSupervisor,
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
      supervisorRefreshScheduled: false,
      completedAt: new Date().toISOString()
    }).catch(() => {});
  } finally {
    await fs.unlink(processing).catch(() => {});
  }

  if (refreshSupervisor) {
    const scheduled = scheduleSupervisorRefresh();
    console.log('[OWNER_OPS_SUPERVISOR_REFRESH]', {
      scheduled,
      reason: 'ORCHESTRATOR_DEPLOY_COMPLETED',
      delaySeconds: scheduled ? 60 : null
    });
  }
}

async function tick() {
  await ensureDirs();
  const files = await fs.readdir(REQUEST_DIR);
  for (const file of files.sort()) await processFile(file);
}

async function main() {
  await ensureDirs();
  const recovered = await recoverInterruptedOperations();

  let whatsappCore = { status: WHATSAPP_CORE_PROTECTED ? 'pending' : 'disabled' };
  if (WHATSAPP_CORE_PROTECTED) {
    try {
      whatsappCore = await runWhatsappCoreWatchdog({ force: true, allowBootstrap: true });
    } catch (error) {
      whatsappCore = { status: 'bootstrap_failed', error: error?.code || error?.message || 'WHATSAPP_CORE_BOOTSTRAP_FAILED' };
      console.error('[WHATSAPP_CORE_BOOTSTRAP_FAILED]', whatsappCore.error);
    }
  }

  console.log(`[OWNER_OPS_SUPERVISOR] READY recovered=${recovered} whatsappCore=${whatsappCore.status}`);

  for (;;) {
    try {
      await tick();
      const watchdog = await runWhatsappCoreWatchdog();
      if (watchdog?.status === 'rolled_back') {
        console.error('[WHATSAPP_CORE_WATCHDOG_RECOVERED]', watchdog.restoredSha);
      }
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
  buildRepository,
  cleanGeneratedConnectCatalog,
  deployRepository,
  executeRequest,
  installDependencies,
  porcelainEntries,
  porcelainEntry,
  porcelainPath,
  recoverInterruptedOperations,
  readWhatsappCoreState,
  writeWhatsappCoreState,
  readProtectedComponentState,
  writeProtectedComponentState,
  markProtectedComponentsGood,
  runProtectedComponentContract,
  runProtectedComponentContracts,
  readOrchestratorRepoState,
  markWhatsappCoreGood,
  restoreWhatsappCoreLastGood,
  runWhatsappCoreWatchdog,
  restartService,
  sanitizeTechnicalError,
  shouldRefreshSupervisorAfterRequest,
  verifyOrchestratorHttpHealth,
  verifyLangflowHttpHealth,
  verifyLangflowHostPreflight,
  ensureLangflowRuntimeEnv,
  deployLangflowComponent,
  verifyPort,
  verifyService,
  verifyWhatsappBridgeHealth,
  runWhatsappCoreContract,
  restoreOrchestratorBaseline,
  isRecoverableDetachedConnectBranch,
  restoreConnectBaseline
};
