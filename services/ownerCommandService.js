'use strict';

const { createJob } = require('./jobs/jobEngine');
const { executeJob } = require('./jobs/jobExecutor');
const { JOB_TYPES } = require('./jobs/jobTypes');

const OWNER_COMMANDS = Object.freeze({
  CONTEXT_SYNC: 'context_sync'
});

function normalizeCommand(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function detectOwnerCommand(message) {
  const normalized = normalizeCommand(message);

  if (
    normalized === 'CONTEXT SYNC' ||
    normalized === 'SYNC CONTEXT' ||
    normalized === 'SINCRONIZAR CONTEXTO' ||
    normalized === 'CARGAR CONTEXTO'
  ) {
    return OWNER_COMMANDS.CONTEXT_SYNC;
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

async function executeOwnerCommand({ command, platform }) {
  if (command !== OWNER_COMMANDS.CONTEXT_SYNC) {
    throw new Error(`Comando owner no soportado: ${command}`);
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
  formatContextSyncResult
};
