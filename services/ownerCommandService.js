'use strict';

const { createJob, getJob } = require('./jobs/jobEngine');
const { executeJob } = require('./jobs/jobExecutor');
const { JOB_TYPES } = require('./jobs/jobTypes');

const OWNER_COMMANDS = Object.freeze({
  CONTEXT_SYNC: 'context_sync',
  CANCEL_FLOW: 'cancel_flow',
  CODE_JOB: 'code_job',
  JOB_STATUS: 'job_status'
});

const PLATFORM_ALIASES = Object.freeze([
  { id: 'elan-ai', aliases: ['elan ia', 'elan ai', 'elan-ai'] },
  { id: 'elanvisual', aliases: ['elanvisual', 'elan visual'] },
  { id: 'elanpet', aliases: ['elanpet', 'elan pet'] },
  { id: 'elankav-core', aliases: ['elankav core', 'elan core', 'elankav-core'] },
  { id: 'elankav-platform', aliases: ['elankav platform', 'plataforma elankav', 'elankav-platform'] }
]);

const CODE_ACTION_PATTERN = /\b(audita|auditar|revisa|revisar|corrige|corregir|programa|programar|implementa|implementar|crea|crear|modifica|modificar|repara|reparar|actualiza|actualizar)\b/;
const CANCEL_PATTERN = /^(cancelar|cancela|detener|deten|parar|para|olvida eso|olvidalo|deja eso|dejalo|cambiar de tema|cambiemos de tema|cancelar esta conversacion|da por cancelar esta conversacion|elimina esa orden|cancelar esta orden)$/;
const JOB_ID_PATTERN = /\bJOB-(\d+)-([a-z0-9]+)\b/i;
const JOB_STATUS_PATTERN = /\b(estado|estatus|avance|seguimiento|resultado|resultados|como va|que paso|error|errores|pull request|pr)\b/;

function normalizeCommand(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function resolvePlatformFromMessage(normalizedMessage) {
  for (const platform of PLATFORM_ALIASES) {
    if (platform.aliases.some(alias => normalizedMessage.includes(alias))) {
      return platform.id;
    }
  }

  return null;
}

function detectJobStatusCommand(message, normalizedMessage) {
  const match = String(message || '').match(JOB_ID_PATTERN);

  if (!match || !JOB_STATUS_PATTERN.test(normalizedMessage)) {
    return null;
  }

  return Object.freeze({
    type: OWNER_COMMANDS.JOB_STATUS,
    jobId: `JOB-${match[1]}-${match[2].toLowerCase()}`
  });
}

function detectOwnerCommand(message) {
  const normalized = normalizeCommand(message);
  const jobStatusCommand = detectJobStatusCommand(message, normalized);

  if (jobStatusCommand) {
    return jobStatusCommand;
  }

  if (
    normalized === 'context sync' ||
    normalized === 'sync context' ||
    normalized === 'sincronizar contexto' ||
    normalized === 'cargar contexto'
  ) {
    return OWNER_COMMANDS.CONTEXT_SYNC;
  }

  if (CANCEL_PATTERN.test(normalized)) {
    return OWNER_COMMANDS.CANCEL_FLOW;
  }

  const platform = resolvePlatformFromMessage(normalized);

  if (platform && CODE_ACTION_PATTERN.test(normalized)) {
    return Object.freeze({
      type: OWNER_COMMANDS.CODE_JOB,
      platform,
      task: String(message || '').trim()
    });
  }

  return null;
}

function cleanDocumentContent(document) {
  if (!document?.available || !document.content) {
    return 'No disponible.';
  }

  return String(document.content).trim();
}

function formatContextSyncResult(job) {
  const result = job?.result;

  if (!result) {
    return 'No fue posible cargar el contexto oficial de ELANKAV.';
  }

  const documents = result.documents || {};
  const orchestratorGit = result.git?.orchestrator;
  const osGit = result.git?.elankavOs;

  return [
    'Contexto oficial de ELANKAV cargado.',
    '',
    'ESTADO ACTUAL',
    cleanDocumentContent(documents.currentState),
    '',
    'PRÓXIMA TAREA',
    cleanDocumentContent(documents.nextTask),
    '',
    'DECISIONES VIGENTES',
    cleanDocumentContent(documents.decisions),
    '',
    'CONTROL DE VERSIONES',
    `Orchestrator: ${orchestratorGit?.branch || 'sin rama'} — ${orchestratorGit?.commit || 'sin commit'}`,
    `ELANKAV OS: ${osGit?.branch || 'sin rama'} — ${osGit?.commit || 'sin commit'}`,
    '',
    `Job: ${job.id}`,
    `Modo: ${result.mode || 'read-only'}`,
    `Estado: ${job.status}`
  ].join('\n');
}

function formatCodeJobAccepted(job) {
  return [
    'Orden de programación aceptada.',
    '',
    `Job: ${job.id}`,
    `Plataforma: ${job.platform}`,
    `Rama temporal: ${job.branch}`,
    `Estado: ${job.status}`,
    '',
    'Codex trabajará en un workspace aislado. El flujo puede crear una rama y un Pull Request, pero no hará merge ni despliegue automático.'
  ].join('\n');
}

function formatJobStatusResult(job) {
  if (!job) {
    return 'No encontré ese Job en el registro activo del Orchestrator. Es posible que el servicio se haya reiniciado.';
  }

  const completedSteps = Array.isArray(job.result?.steps)
    ? job.result.steps.map(step => step.step).filter(Boolean)
    : [];
  const pullRequest = Array.isArray(job.result?.steps)
    ? job.result.steps.find(step => step.step === 'pr')
    : null;

  return [
    'Estado verificado del Job.',
    '',
    `Job: ${job.id}`,
    `Plataforma: ${job.platform}`,
    `Estado: ${job.status}`,
    `Rama: ${job.branch || 'No aplica'}`,
    `Pasos completados: ${completedSteps.length ? completedSteps.join(', ') : 'Aún no disponibles'}`,
    `Error: ${job.error || 'Ninguno'}`,
    `Pull Request: ${pullRequest?.url || 'Todavía no disponible'}`,
    `Creado: ${job.createdAt || 'No disponible'}`,
    `Finalizado: ${job.finishedAt || 'Todavía no finalizado'}`
  ].join('\n');
}

async function executeOwnerCommand({ command, platform }) {
  if (command === OWNER_COMMANDS.CANCEL_FLOW) {
    return {
      command,
      job: null,
      outputText: 'Entendido. Cancelé el proceso activo. Decime qué necesitás ahora.'
    };
  }

  if (command?.type === OWNER_COMMANDS.JOB_STATUS) {
    const job = getJob(command.jobId);

    return {
      command: OWNER_COMMANDS.JOB_STATUS,
      job,
      outputText: formatJobStatusResult(job)
    };
  }

  if (command?.type === OWNER_COMMANDS.CODE_JOB) {
    const job = createJob({
      platform: command.platform,
      type: JOB_TYPES.CODE,
      task: command.task
    });

    executeJob(job.id).catch(error => {
      console.error(`[OWNER_CODE_JOB_ERROR] ${job.id}: ${error.message}`);
    });

    return {
      command: OWNER_COMMANDS.CODE_JOB,
      job,
      outputText: formatCodeJobAccepted(job)
    };
  }

  if (command !== OWNER_COMMANDS.CONTEXT_SYNC) {
    throw new Error(`Comando owner no soportado: ${JSON.stringify(command)}`);
  }

  const job = createJob({
    platform: platform || 'elankav',
    type: JOB_TYPES.CONTEXT_SYNC,
    task: 'Cargar contexto oficial del ecosistema ELANKAV'
  });

  const completedJob = await executeJob(job.id);

  return {
    command,
    job: completedJob,
    outputText: formatContextSyncResult(completedJob)
  };
}

module.exports = {
  OWNER_COMMANDS,
  detectJobStatusCommand,
  detectOwnerCommand,
  executeOwnerCommand,
  formatContextSyncResult,
  formatCodeJobAccepted,
  formatJobStatusResult,
  resolvePlatformFromMessage
};
