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
  executeReadOperation,
  formatResult: formatOwnerOpsResult
} = require('./ownerOpsReadService');
const {
  createPendingOperation,
  formatPendingOperation
} = require('./ownerOpsConfirmationService');
const {
  executeConfirmedOperation,
  formatSensitiveResult
} = require('./ownerOpsSensitiveExecutor');
const {
  formatModeState,
  getOperatorState,
  resolveMode,
  setOperatorMode
} = require('./operatorModeService');
const {
  detectOwnerBusinessCommand,
  executeOwnerBusinessCommand
} = require('./ownerBusinessCommandService');
const {
  learnAlias
} = require('./ownerLanguageProfileService');

const OWNER_COMMANDS = Object.freeze({
  CONTEXT_SYNC: 'context_sync',
  CANCEL_FLOW: 'cancel_flow',
  CODE_JOB: 'code_job',
  JOB_STATUS: 'job_status',
  JOBS_LIST: 'jobs_list',
  CAPABILITY_CATALOG: 'capability_catalog',
  WAHA_STATUS: 'waha_status',
  QUOTE_QUERY: 'quote_query',
  SEND_DESIGN_LINK: 'send_design_link',
  OWNER_OPS_READ: 'owner_ops_read',
  OWNER_OPS_PREPARE_SENSITIVE: 'owner_ops_prepare_sensitive',
  OWNER_OPS_CONFIRM: 'owner_ops_confirm',
  MODE_GET: 'mode_get',
  MODE_SET: 'mode_set',
  LANGUAGE_LEARN: 'language_learn',
  BUSINESS_TRANSACTION: 'business_transaction'
});

const PLATFORM_ALIASES = Object.freeze([
  { id: 'elan-ai', aliases: ['elan ia', 'elan ai', 'elan-ai'] },
  { id: 'elanvisual', aliases: ['elanvisual', 'elan visual'] },
  { id: 'elanpet', aliases: ['elanpet', 'elan pet'] },
  { id: 'elankav-core', aliases: ['elankav core', 'elan core', 'elankav-core'] },
  { id: 'elankav-platform', aliases: ['elankav platform', 'plataforma elankav', 'elankav-platform'] }
]);

const CODE_ACTION_PATTERN = /\b(audita|auditar|revisa|revisar|corrige|corregir|programa|programar|implementa|implementar|crea|crear|modifica|modificar|repara|reparar|actualiza|actualizar)\b/;
const READ_ONLY_PATTERN = /\b(read only|solo lectura|no crear job|no crees ningun job|no usar codex|no uses codex|no ejecutar acciones|consulta|consultar|lista|listar|mostrar|estado)\b/;
const CANCEL_PATTERN = /^(cancelar|cancela|detener|deten|parar|para|olvida eso|olvidalo|deja eso|dejalo|cambiar de tema|cambiemos de tema|cancelar esta conversacion|da por cancelar esta conversacion|elimina esa orden|cancelar esta orden)$/;
const JOB_ID_PATTERN = /\bJOB-(\d+)-([a-z0-9]+)\b/i;
const OPS_ID_PATTERN = /\bOPS-(\d+)-([A-Z0-9]{6})\b/i;
const JOB_STATUS_PATTERN = /\b(estado|estatus|avance|seguimiento|resultado|resultados|como va|que paso|error|errores|pull request|pr)\b/;
const DESIGN_LINK_ACTION_PATTERN = /\b(envia|enviale|manda|mandale|comparte|compartile|pasale)\b/;
const DESIGN_LINK_TARGET_PATTERN = /\b(link|enlace|formulario|sitio)\b.*\b(diseno|disenar|diseño)\b|\b(diseno|disenar|diseño)\b.*\b(link|enlace|formulario|sitio)\b/;
const CAPABILITY_PATTERN = /\b(catalogo|capacidades|acciones registradas|herramientas registradas|owner router)\b/;
const JOBS_LIST_PATTERN = /\b(ultimos|recientes|lista|listar|mostra|mostrar)\b.*\bjobs?\b|\bjobs?\b.*\b(ultimos|recientes|lista|listar|mostra|mostrar)\b/;
const WAHA_STATUS_PATTERN = /\b(waha)\b.*\b(estado|sesion|status|verifica|consulta|consultar)\b|\b(estado|sesion|status)\b.*\b(waha)\b/;
const PUBLISH_PREPARED_PATTERN = /\b(publica|publicar|publicalo|publicala|sube|subir|crea pr|crear pr|abre pr|abrir pr|pull request)\b/;
const MODE_QUERY_PATTERN = /\b(en que modo|que modo|modo actual|cual es tu modo|que rol operativo|modo estas)\b/;
const MODE_SET_PATTERN = /^(?:elan\s*[,;:]?\s*)?(?:actua como|trabaja como|ponte en modo|cambia a modo|cambiar a modo|cambia modo a|cambiar modo a|entra en modo|modo)\s+(.+)$/;

function normalizeCommand(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function cleanOwnerLanguageLearnValue(value) {
  return String(value || '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

function detectOwnerLanguageLearnCommand(
  message,
  normalizedMessage = normalizeCommand(message)
) {
  const patterns = [
    /^(?:elan\s*[,;:]?\s*)?cuando digo\s+(.+?)\s+quiero decir\s+(.+)$/,
    /^(?:elan\s*[,;:]?\s*)?aprende que\s+(.+?)\s+significa\s+(.+)$/
  ];

  for (const pattern of patterns) {
    const match = normalizedMessage.match(pattern);
    if (!match) continue;

    const spoken = cleanOwnerLanguageLearnValue(match[1]);
    const canonical = cleanOwnerLanguageLearnValue(match[2]);

    if (!spoken || !canonical || spoken === canonical) return null;

    return Object.freeze({
      type: OWNER_COMMANDS.LANGUAGE_LEARN,
      spoken,
      canonical
    });
  }

  return null;
}

function resolvePlatformFromMessage(normalizedMessage) {
  for (const platform of PLATFORM_ALIASES) {
    if (platform.aliases.some(alias => normalizedMessage.includes(alias))) return platform.id;
  }
  return null;
}

function resolveOwnerOpsTarget(normalizedMessage) {
  if (/\b(connect|elankav connect)\b/.test(normalizedMessage)) return 'connect';
  if (/\b(orchestrator|orquestador)\b/.test(normalizedMessage)) return 'orchestrator';
  return null;
}

function detectOwnerModeCommand(message, normalizedMessage = normalizeCommand(message)) {
  if (MODE_QUERY_PATTERN.test(normalizedMessage)) return Object.freeze({ type: OWNER_COMMANDS.MODE_GET });
  const match = normalizedMessage.match(MODE_SET_PATTERN);
  if (!match) return null;
  const mode = resolveMode(match[1]);
  if (!mode) return null;
  return Object.freeze({ type: OWNER_COMMANDS.MODE_SET, mode });
}

function detectOwnerOpsReadCommand(normalizedMessage) {
  const target = resolveOwnerOpsTarget(normalizedMessage);
  if (/\b(audita|auditar|revisa|revisar|diagnostica|diagnosticar)\b/.test(normalizedMessage) && /\b(produccion)\b/.test(normalizedMessage)) return Object.freeze({ type: OWNER_COMMANDS.OWNER_OPS_READ, capability: 'production.audit' });
  if (/\b(audita|auditar|revisa|revisar|diagnostica|diagnosticar|estado|salud)\b/.test(normalizedMessage) && /\b(servidor|vps|sistema)\b/.test(normalizedMessage)) return Object.freeze({ type: OWNER_COMMANDS.OWNER_OPS_READ, capability: 'server.summary' });
  if (target && /\b(log|logs|errores|error|journal|registro|registros)\b/.test(normalizedMessage)) return Object.freeze({ type: OWNER_COMMANDS.OWNER_OPS_READ, capability: 'service.logs', target, lines: 100 });
  if (target && /\b(git|repo|repositorio|rama|branch|commit|cambios locales|diff)\b/.test(normalizedMessage)) return Object.freeze({ type: OWNER_COMMANDS.OWNER_OPS_READ, capability: 'git.status', target });
  if (target && /\b(estado|status|activo|activa|corriendo|levantado|levantada|servicio|health|salud|revisa|revisar|verifica|verificar)\b/.test(normalizedMessage)) return Object.freeze({ type: OWNER_COMMANDS.OWNER_OPS_READ, capability: 'service.status', target });
  return null;
}

function detectPreparedPublishCommand(message, normalizedMessage) {
  if (!PUBLISH_PREPARED_PATTERN.test(normalizedMessage)) return null;
  const match = String(message || '').match(JOB_ID_PATTERN);
  if (!match) return null;
  const jobId = `JOB-${match[1]}-${match[2].toLowerCase()}`;
  return Object.freeze({
    type: OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE,
    capability: 'git.publish-prepared',
    target: 'prepared-code',
    summary: `Publicar corrección preparada ${jobId}`,
    impact: 'Se publicará la rama temporal y se creará un Pull Request. No se hará merge ni deploy.',
    parameters: Object.freeze({ jobId })
  });
}

function detectOwnerOpsSensitiveCommand(message, normalizedMessage) {
  const preparedPublish = detectPreparedPublishCommand(message, normalizedMessage);
  if (preparedPublish) return preparedPublish;
  const target = resolveOwnerOpsTarget(normalizedMessage);
  if (!target) return null;
  if (/\b(reinicia|reiniciar|restart|rearranca|rearrancar)\b/.test(normalizedMessage)) {
    return Object.freeze({
      type: OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE,
      capability: 'service.restart',
      target,
      summary: `Reiniciar ${target === 'connect' ? 'CONNECT' : 'Orchestrator'}`,
      impact: target === 'connect'
        ? 'CONNECT tendrá una interrupción breve y luego se verificará que vuelva a estado active.'
        : 'El reinicio del propio Orchestrator está bloqueado por seguridad hasta disponer de supervisor externo.',
      parameters: Object.freeze({})
    });
  }
  return null;
}

function detectOwnerOpsConfirmation(message) {
  const normalized = normalizeCommand(message);
  if (!normalized.startsWith('confirmar ')) return null;
  const match = String(message || '').toUpperCase().match(OPS_ID_PATTERN);
  if (!match) return null;
  return Object.freeze({ type: OWNER_COMMANDS.OWNER_OPS_CONFIRM, operationId: `OPS-${match[1]}-${match[2]}` });
}

function detectJobStatusCommand(message, normalizedMessage) {
  const match = String(message || '').match(JOB_ID_PATTERN);
  if (!match || !JOB_STATUS_PATTERN.test(normalizedMessage)) return null;
  return Object.freeze({ type: OWNER_COMMANDS.JOB_STATUS, jobId: `JOB-${match[1]}-${match[2].toLowerCase()}` });
}

function detectSendDesignLinkCommand(message, normalizedMessage) {
  if (!DESIGN_LINK_ACTION_PATTERN.test(normalizedMessage) || !DESIGN_LINK_TARGET_PATTERN.test(normalizedMessage)) return null;
  const phone = extractPhone(message);
  if (!phone) return null;
  return Object.freeze({ type: OWNER_COMMANDS.SEND_DESIGN_LINK, phone });
}

function detectOwnerCommand(message) {
  const normalized = normalizeCommand(message);

  const languageLearnCommand =
    detectOwnerLanguageLearnCommand(message, normalized);

  if (languageLearnCommand) return languageLearnCommand;

  const confirmationCommand = detectOwnerOpsConfirmation(message);
  if (confirmationCommand) return confirmationCommand;
  const modeCommand = detectOwnerModeCommand(message, normalized);
  if (modeCommand) return modeCommand;
  const businessCommand = detectOwnerBusinessCommand(message);
  if (businessCommand) return Object.freeze({ type: OWNER_COMMANDS.BUSINESS_TRANSACTION, businessCommand });
  const sensitiveCommand = detectOwnerOpsSensitiveCommand(message, normalized);
  if (sensitiveCommand) return sensitiveCommand;
  const jobStatusCommand = detectJobStatusCommand(message, normalized);
  if (jobStatusCommand) return jobStatusCommand;
  const sendDesignLinkCommand = detectSendDesignLinkCommand(message, normalized);
  if (sendDesignLinkCommand) return sendDesignLinkCommand;
  const ownerOpsReadCommand = detectOwnerOpsReadCommand(normalized);
  if (ownerOpsReadCommand) return ownerOpsReadCommand;
  if (CAPABILITY_PATTERN.test(normalized)) return Object.freeze({ type: OWNER_COMMANDS.CAPABILITY_CATALOG });
  if (JOBS_LIST_PATTERN.test(normalized)) return Object.freeze({ type: OWNER_COMMANDS.JOBS_LIST });
  if (WAHA_STATUS_PATTERN.test(normalized)) return Object.freeze({ type: OWNER_COMMANDS.WAHA_STATUS });
  if (['context sync', 'sync context', 'sincronizar contexto', 'cargar contexto'].includes(normalized)) return OWNER_COMMANDS.CONTEXT_SYNC;
  if (CANCEL_PATTERN.test(normalized)) return OWNER_COMMANDS.CANCEL_FLOW;

  const platform = resolvePlatformFromMessage(normalized);
  if (platform && CODE_ACTION_PATTERN.test(normalized) && !READ_ONLY_PATTERN.test(normalized)) return Object.freeze({ type: OWNER_COMMANDS.CODE_JOB, platform, task: String(message || '').trim() });
  if (String(process.env.QUOTE_CORE_RUNTIME_ENABLED || '').toLowerCase() === 'true' && resolveQuoteRuntimeIntent(message)) return Object.freeze({ type: OWNER_COMMANDS.QUOTE_QUERY, message: String(message || '').trim() });
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

function formatCodeJobAccepted(job) {
  return [
    'Preparación técnica aceptada.', '',
    `Job: ${job.id}`,
    `Plataforma: ${job.platform}`,
    `Rama local temporal: ${job.branch}`,
    `Estado: ${job.status}`, '',
    'Codex trabajará en un workspace aislado y ejecutará QA.',
    'Este flujo NO publica la rama, NO hace git push, NO crea Pull Request, NO hace merge y NO despliega producción.'
  ].join('\n');
}

function formatJobStatusResult(job) {
  if (!job) return 'No encontré ese Job en el registro activo del Orchestrator.';
  const completedSteps = Array.isArray(job.result?.steps) ? job.result.steps.map(step => step.step).filter(Boolean) : [];
  const pullRequest = Array.isArray(job.result?.steps) ? job.result.steps.find(step => step.step === 'pr') : null;
  return [
    'Estado verificado del Job.', '',
    `Job: ${job.id}`,
    `Plataforma: ${job.platform}`,
    `Estado: ${job.status}`,
    `Rama: ${job.branch || 'No aplica'}`,
    `Pasos completados: ${completedSteps.length ? completedSteps.join(', ') : 'Aún no disponibles'}`,
    `Error: ${job.error || 'Ninguno'}`,
    `Pull Request: ${pullRequest?.url || 'No publicado'}`,
    `Creado: ${job.createdAt || 'No disponible'}`,
    `Finalizado: ${job.finishedAt || 'Todavía no finalizado'}`
  ].join('\n');
}

async function executeOwnerCommand({ command, platform }) {
  const type = typeof command === 'string' ? command : command?.type;

  if (type === OWNER_COMMANDS.MODE_GET) {
    const state = await getOperatorState({ operatorId: 'owner', role: 'OWNER' });
    return { command: type, job: null, outputText: formatModeState(state), operatorMode: state };
  }
  if (type === OWNER_COMMANDS.MODE_SET) {
    const state = await setOperatorMode({ operatorId: 'owner', role: 'OWNER', mode: command.mode });
    return { command: type, job: null, outputText: `Modo operativo actualizado.\n${formatModeState(state)}`, operatorMode: state };
  }
  if (type === OWNER_COMMANDS.LANGUAGE_LEARN) {
    const learned = await learnAlias({
      spoken: command.spoken,
      canonical: command.canonical
    });

    return {
      command: type,
      job: null,
      outputText: [
        'Aprendizaje lingüístico guardado.',
        `Cuando digás: ${learned.spoken}`,
        `Interpretaré: ${learned.canonical}`
      ].join('\n'),
      languageLearning: learned
    };
  }
  if (type === OWNER_COMMANDS.BUSINESS_TRANSACTION) {
    const result = await executeOwnerBusinessCommand(command.businessCommand);
    if (!result.handled) throw Object.assign(new Error('OWNER_BUSINESS_COMMAND_NOT_HANDLED'), { code: 'OWNER_BUSINESS_COMMAND_NOT_HANDLED' });
    return { command: type, job: result.result?.id ? result.result : null, outputText: result.outputText, business: result.result };
  }
  if (type === OWNER_COMMANDS.CANCEL_FLOW) return { command: type, job: null, outputText: 'Entendido. Cancelé el proceso activo. Decime qué necesitás ahora.' };
  if (type === OWNER_COMMANDS.OWNER_OPS_CONFIRM) {
    const result = await executeConfirmedOperation(command.operationId);
    return { command: type, job: result.job, outputText: formatSensitiveResult(result), ownerOps: result.execution };
  }
  if (type === OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE) {
    const operation = await createPendingOperation({
      capability: command.capability,
      target: command.target,
      summary: command.summary,
      impact: command.impact,
      parameters: command.parameters || {},
      requestedBy: 'owner-whatsapp'
    });
    return { command: type, job: operation, outputText: formatPendingOperation(operation), ownerOps: operation.result?.operation || null };
  }
  if (type === OWNER_COMMANDS.OWNER_OPS_READ) {
    const result = await executeReadOperation(command);
    return { command: type, job: null, outputText: formatOwnerOpsResult(result), ownerOps: result };
  }
  if (type === OWNER_COMMANDS.CAPABILITY_CATALOG) return { command: type, job: null, outputText: formatCapabilityCatalog() };
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
    const job = await createJob({ platform: command.platform, type: JOB_TYPES.CODE_PREPARE, task: command.task });
    executeJob(job.id).catch(error => console.error(`[OWNER_CODE_PREPARE_ERROR] ${job.id}: ${error.message}`));
    return { command: type, job, outputText: formatCodeJobAccepted(job) };
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
  if (type !== OWNER_COMMANDS.CONTEXT_SYNC) throw new Error(`Comando owner no soportado: ${JSON.stringify(command)}`);

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
  detectJobStatusCommand,
  detectOwnerCommand,
  detectOwnerLanguageLearnCommand,
  detectOwnerModeCommand,
  detectOwnerOpsConfirmation,
  detectOwnerOpsReadCommand,
  detectOwnerOpsSensitiveCommand,
  detectPreparedPublishCommand,
  detectSendDesignLinkCommand,
  executeOwnerCommand,
  formatContextSyncResult,
  formatCodeJobAccepted,
  formatJobStatusResult,
  resolvePlatformFromMessage
};
