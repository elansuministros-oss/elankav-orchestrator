'use strict';

const { createJob, getJob } = require('./jobs/jobEngine');
const { executeJob } = require('./jobs/jobExecutor');
const { JOB_TYPES } = require('./jobs/jobTypes');
const {
  processQuoteRuntimeCommand,
  resolveIntent: resolveQuoteRuntimeIntent
} = require('./quoteCore/quoteCommandRuntimeService');
const { extractPhone, sendDesignLink } = require('./ownerWahaSendService');
const {
  formatCapabilityCatalog,
  formatRecentJobs,
  formatWahaStatus,
  getRecentJobs,
  readWahaSession
} = require('./ownerOperationalReadService');
const {
  INTENT_TYPES,
  OPERATION_STATUSES
} = require('./autonomousOperations');
const {
  getAutonomousOperationService
} = require('./autonomousOperations/runtime');

const OWNER_COMMANDS = Object.freeze({
  CONTEXT_SYNC: 'context_sync',
  CANCEL_FLOW: 'cancel_flow',
  CODE_JOB: 'code_job',
  JOB_STATUS: 'job_status',
  JOBS_LIST: 'jobs_list',
  CAPABILITY_CATALOG: 'capability_catalog',
  WAHA_STATUS: 'waha_status',
  QUOTE_QUERY: 'quote_query',
  SEND_DESIGN_LINK: 'send_design_link'
});

const PLATFORM_ALIASES = Object.freeze([
  { id: 'elan-ai', aliases: ['elan ia', 'elan ai', 'elan-ai'] },
  { id: 'elanvisual', aliases: ['elanvisual', 'elan visual'] },
  { id: 'elanpet', aliases: ['elanpet', 'elan pet'] },
  { id: 'elankav-core', aliases: ['elankav core', 'elan core', 'elankav-core'] },
  { id: 'elankav-platform', aliases: ['elankav platform', 'plataforma elankav', 'elankav-platform'] }
]);

const CODE_ACTION_PATTERN = /\b(audita|auditar|revisa|revisar|corrige|corregir|programa|programar|implementa|implementar|crea|crear|modifica|modificar|repara|reparar|actualiza|actualizar)\b/;
const READ_ONLY_PATTERN = /\b(read only|solo lectura|no crear job|no crees ningun job|no usar codex|no uses codex|no ejecutar acciones|consult(a|ar|á)|lista(r)?|mostrar|estado)\b/;
const CANCEL_PATTERN = /^(cancelar|cancela|detener|deten|parar|para|olvida eso|olvidalo|deja eso|dejalo|cambiar de tema|cambiemos de tema|cancelar esta conversacion|da por cancelar esta conversacion|elimina esa orden|cancelar esta orden)$/;
const JOB_ID_PATTERN = /\bJOB-(\d+)-([a-z0-9]+)\b/i;
const JOB_STATUS_PATTERN = /\b(estado|estatus|avance|seguimiento|resultado|resultados|como va|que paso|error|errores|pull request|pr)\b/;
const DESIGN_LINK_ACTION_PATTERN = /\b(envia|enviale|manda|mandale|comparte|compartile|pasale)\b/;
const DESIGN_LINK_TARGET_PATTERN = /\b(link|enlace|formulario|sitio)\b.*\b(diseno|diseñar|diseño)\b|\b(diseno|diseñar|diseño)\b.*\b(link|enlace|formulario|sitio)\b/;
const CAPABILITY_PATTERN = /\b(catalogo|catálogo|capacidades|acciones registradas|herramientas registradas|owner router)\b/;
const JOBS_LIST_PATTERN = /\b(ultimos|últimos|recientes|lista|listar|mostra|mostrar)\b.*\bjobs?\b|\bjobs?\b.*\b(ultimos|últimos|recientes|lista|listar|mostra|mostrar)\b/;
const WAHA_STATUS_PATTERN = /\b(waha)\b.*\b(estado|sesion|sesión|status|verifica|consult(a|ar|á))\b|\b(estado|sesion|sesión|status)\b.*\b(waha)\b/;

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
    if (platform.aliases.some(alias => normalizedMessage.includes(alias))) return platform.id;
  }
  return null;
}

function detectJobStatusCommand(message, normalizedMessage) {
  const match = String(message || '').match(JOB_ID_PATTERN);
  if (!match || !JOB_STATUS_PATTERN.test(normalizedMessage)) return null;
  return Object.freeze({
    type: OWNER_COMMANDS.JOB_STATUS,
    jobId: `JOB-${match[1]}-${match[2].toLowerCase()}`
  });
}

function detectSendDesignLinkCommand(message, normalizedMessage) {
  if (!DESIGN_LINK_ACTION_PATTERN.test(normalizedMessage) || !DESIGN_LINK_TARGET_PATTERN.test(normalizedMessage)) return null;
  const phone = extractPhone(message);
  if (!phone) return null;
  return Object.freeze({ type: OWNER_COMMANDS.SEND_DESIGN_LINK, phone });
}

function detectOwnerCommand(message) {
  const normalized = normalizeCommand(message);
  const jobStatusCommand = detectJobStatusCommand(message, normalized);
  if (jobStatusCommand) return jobStatusCommand;

  const sendDesignLinkCommand = detectSendDesignLinkCommand(message, normalized);
  if (sendDesignLinkCommand) return sendDesignLinkCommand;

  if (CAPABILITY_PATTERN.test(normalized)) {
    return Object.freeze({ type: OWNER_COMMANDS.CAPABILITY_CATALOG });
  }
  if (JOBS_LIST_PATTERN.test(normalized)) {
    return Object.freeze({ type: OWNER_COMMANDS.JOBS_LIST });
  }
  if (WAHA_STATUS_PATTERN.test(normalized)) {
    return Object.freeze({ type: OWNER_COMMANDS.WAHA_STATUS });
  }

  if (['context sync', 'sync context', 'sincronizar contexto', 'cargar contexto'].includes(normalized)) {
    return OWNER_COMMANDS.CONTEXT_SYNC;
  }
  if (CANCEL_PATTERN.test(normalized)) return OWNER_COMMANDS.CANCEL_FLOW;

  const platform = resolvePlatformFromMessage(normalized);
  if (platform && CODE_ACTION_PATTERN.test(normalized) && !READ_ONLY_PATTERN.test(normalized)) {
    return Object.freeze({
      type: OWNER_COMMANDS.CODE_JOB,
      platform,
      task: String(message || '').trim()
    });
  }

  if (
    String(process.env.QUOTE_CORE_RUNTIME_ENABLED || '').toLowerCase() === 'true' &&
    resolveQuoteRuntimeIntent(message)
  ) {
    return Object.freeze({ type: OWNER_COMMANDS.QUOTE_QUERY, message: String(message || '').trim() });
  }

  return null;
}

function cleanDocumentContent(document) {
  return !document?.available || !document.content ? 'No disponible.' : String(document.content).trim();
}

function formatContextSyncResult(job) {
  const result = job?.result;
  if (!result) return 'No fue posible cargar el contexto oficial de ELANKAV.';
  const documents = result.documents || {};
  const orchestratorGit = result.git?.orchestrator;
  const osGit = result.git?.elankavOs;
  return [
    'Contexto oficial de ELANKAV cargado.', '',
    'ESTADO ACTUAL', cleanDocumentContent(documents.currentState), '',
    'PRÓXIMA TAREA', cleanDocumentContent(documents.nextTask), '',
    'DECISIONES VIGENTES', cleanDocumentContent(documents.decisions), '',
    'CONTROL DE VERSIONES',
    `Orchestrator: ${orchestratorGit?.branch || 'sin rama'} — ${orchestratorGit?.commit || 'sin commit'}`,
    `ELANKAV OS: ${osGit?.branch || 'sin rama'} — ${osGit?.commit || 'sin commit'}`, '',
    `Job: ${job.id}`,
    `Modo: ${result.mode || 'read-only'}`,
    `Estado: ${job.status}`
  ].join('\n');
}

function formatCodeJobAccepted(job, operation) {
  return [
    'Orden de programación aceptada.', '',
    `Operación: ${operation?.id || 'No disponible'}`,
    `Riesgo: ${operation?.risk?.level || 'No disponible'}`,
    `Job: ${job.id}`,
    `Plataforma: ${job.platform}`,
    `Rama temporal: ${job.branch}`,
    `Estado: ${job.status}`, '',
    'El Orchestrator registrará la operación, ejecutará el workspace aislado y validará el resultado. No hará merge ni despliegue automático.'
  ].join('\n');
}

function formatJobStatusResult(job) {
  if (!job) return 'No encontré ese Job en el registro activo del Orchestrator.';
  const completedSteps = Array.isArray(job.result?.steps)
    ? job.result.steps.map(step => step.step).filter(Boolean)
    : [];
  const pullRequest = Array.isArray(job.result?.steps)
    ? job.result.steps.find(step => step.step === 'pr')
    : null;
  return [
    'Estado verificado del Job.', '',
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

async function createGovernedCodeOperation(command) {
  const service = getAutonomousOperationService();
  const operation = await service.createOperation({
    originalMessage: command.task,
    actor: {
      type: 'OWNER',
      identityId: 'owner-router',
      channel: 'whatsapp',
      verified: true
    },
    source: {
      type: 'OWNER_COMMAND',
      command: OWNER_COMMANDS.CODE_JOB
    },
    intent: {
      type: INTENT_TYPES.CODE_CHANGE,
      objective: command.task,
      requestedActions: ['CREATE_CODE_JOB'],
      deployRequested: false,
      mergeRequested: false
    },
    target: {
      workspaceId: command.platform,
      environment: 'isolated-workspace',
      destructive: false
    }
  });

  await service.transition(operation.id, OPERATION_STATUSES.RESOLVING);
  await service.transition(operation.id, OPERATION_STATUSES.PLANNING, {
    plan: {
      summary: command.task,
      actions: ['CREATE_CODE_JOB', 'EXECUTE_ISOLATED_JOB', 'VALIDATE_RESULT'],
      constraints: ['NO_MERGE', 'NO_DEPLOY']
    }
  });
  await service.transition(operation.id, OPERATION_STATUSES.POLICY_REVIEW);
  return service.transition(operation.id, OPERATION_STATUSES.EXECUTING);
}

async function completeGovernedCodeOperation(operationId, jobPromise) {
  const service = getAutonomousOperationService();
  try {
    const completedJob = await jobPromise;
    await service.transition(operationId, OPERATION_STATUSES.VALIDATING, {
      actionResults: [{ type: 'CODE_JOB', jobId: completedJob.id, status: completedJob.status }]
    });
    await service.transition(operationId, OPERATION_STATUSES.READY_TO_PUBLISH, {
      validations: [{ type: 'JOB_RESULT', status: completedJob.status }]
    });
    await service.transition(operationId, OPERATION_STATUSES.COMPLETED, {
      evidence: [{ type: 'JOB_REFERENCE', reference: completedJob.id }]
    });
  } catch (error) {
    try {
      await service.transition(operationId, OPERATION_STATUSES.FAILED, {
        failure: { code: error.code || 'CODE_JOB_FAILED', message: error.message }
      });
    } catch (transitionError) {
      console.error(`[AUTONOMOUS_OPERATION_ERROR] ${operationId}: ${transitionError.message}`);
    }
    console.error(`[OWNER_CODE_JOB_ERROR] ${operationId}: ${error.message}`);
  }
}

async function executeOwnerCommand({ command, platform }) {
  const type = typeof command === 'string' ? command : command?.type;

  if (type === OWNER_COMMANDS.CANCEL_FLOW) {
    return { command: type, job: null, outputText: 'Entendido. Cancelé el proceso activo. Decime qué necesitás ahora.' };
  }
  if (type === OWNER_COMMANDS.CAPABILITY_CATALOG) {
    return { command: type, job: null, outputText: formatCapabilityCatalog() };
  }
  if (type === OWNER_COMMANDS.JOBS_LIST) {
    const jobs = await getRecentJobs(3);
    return { command: type, job: null, outputText: formatRecentJobs(jobs), jobs };
  }
  if (type === OWNER_COMMANDS.WAHA_STATUS) {
    const result = await readWahaSession();
    return { command: type, job: null, outputText: formatWahaStatus(result), waha: result };
  }
  if (type === OWNER_COMMANDS.SEND_DESIGN_LINK) {
    const sent = await sendDesignLink({ phone: command.phone });
    return { command: type, job: null, outputText: `Mensaje enviado correctamente a +${sent.phone}.\n\nEnlace: ${sent.link}`, delivery: sent };
  }
  if (type === OWNER_COMMANDS.JOB_STATUS) {
    const job = await getJob(command.jobId);
    return { command: type, job, outputText: formatJobStatusResult(job) };
  }
  if (type === OWNER_COMMANDS.CODE_JOB) {
    const operation = await createGovernedCodeOperation(command);
    const job = await createJob({ platform: command.platform, type: JOB_TYPES.CODE, task: command.task });
    completeGovernedCodeOperation(operation.id, executeJob(job.id));
    return {
      command: type,
      job,
      operation,
      operationId: operation.id,
      outputText: formatCodeJobAccepted(job, operation)
    };
  }
  if (type === OWNER_COMMANDS.QUOTE_QUERY) {
    const result = await processQuoteRuntimeCommand({ message: command.message, actor: { role: 'owner' } });
    if (!result.handled) {
      const error = new Error(result.reason || 'QUOTE_CORE_RUNTIME_UNAVAILABLE');
      error.code = result.reason || 'QUOTE_CORE_RUNTIME_UNAVAILABLE';
      throw error;
    }
    return {
      command: type,
      job: null,
      outputText: result.outputText,
      quoteQuery: { command: result.command, scope: result.scope, rows: result.rows }
    };
  }
  if (type !== OWNER_COMMANDS.CONTEXT_SYNC) {
    throw new Error(`Comando owner no soportado: ${JSON.stringify(command)}`);
  }

  const job = await createJob({
    platform: platform || 'elankav',
    type: JOB_TYPES.CONTEXT_SYNC,
    task: 'Cargar contexto oficial del ecosistema ELANKAV'
  });
  const completedJob = await executeJob(job.id);
  return { command: type, job: completedJob, outputText: formatContextSyncResult(completedJob) };
}

module.exports = {
  OWNER_COMMANDS,
  createGovernedCodeOperation,
  detectJobStatusCommand,
  detectOwnerCommand,
  detectSendDesignLinkCommand,
  executeOwnerCommand,
  formatContextSyncResult,
  formatCodeJobAccepted,
  formatJobStatusResult,
  resolvePlatformFromMessage
};
