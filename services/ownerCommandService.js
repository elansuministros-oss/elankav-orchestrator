'use strict';

const { createJob } = require('./jobs/jobEngine');
const { executeJob } = require('./jobs/jobExecutor');
const { JOB_TYPES } = require('./jobs/jobTypes');

const OWNER_COMMANDS = Object.freeze({
  CONTEXT_SYNC: 'context_sync',
  CANCEL_FLOW: 'cancel_flow',
  CODE_JOB: 'code_job'
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

function detectOwnerCommand(message) {
  const normalized = normalizeCommand(message);

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

async function executeOwnerCommand({ command, platform }) {
  if (command === OWNER_COMMANDS.CANCEL_FLOW) {
    return {
      command,
      job: null,
      outputText: 'Entendido. Cancelé el proceso activo. Decime qué necesitás ahora.'
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
  detectOwnerCommand,
  executeOwnerCommand,
  formatContextSyncResult,
  formatCodeJobAccepted,
  resolvePlatformFromMessage
};