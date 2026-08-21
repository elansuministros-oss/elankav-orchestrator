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
  formatPendingOperation,
  loadPendingOperation
} = require('./ownerOpsConfirmationService');
const {
  executeConfirmedOperation,
  formatSensitiveResult,
  readDeferredOperationResult
} = require('./ownerOpsSensitiveExecutor');
const {
  TECHNICAL_OWNER_OPS_CAPABILITIES,
  canUseModeCapability,
  formatModeState,
  getModeTechnicalCapabilities,
  getOperatorState,
  isTechnicalOwnerOpsCapability,
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
const {
  getCapability
} = require('./ownerOpsCapabilityRegistry');
const { formatElanSelfAudit } = require('./elanSelfAuditService');
const { runTrackedSelfAudit } = require('./elanSelfAuditMonitorService');

const OWNER_COMMANDS = Object.freeze({
  CONTEXT_SYNC: 'context_sync',
  CANCEL_FLOW: 'cancel_flow',
  CODE_JOB: 'code_job',
  JOB_STATUS: 'job_status',
  OPS_STATUS: 'ops_status',
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
  MODE_PERMISSIONS: 'mode_permissions',
  LANGUAGE_LEARN: 'language_learn',
  SELF_AUDIT: 'self_audit',
  BUSINESS_TRANSACTION: 'business_transaction'
});

const PLATFORM_ALIASES = Object.freeze([
  { id: 'elan-ai', aliases: ['elan ia', 'elan ai', 'elan-ai'] },
  { id: 'elanvisual', aliases: ['elanvisual', 'elan visual'] },
  { id: 'elanpet', aliases: ['elanpet', 'elan pet'] },
  { id: 'elankav-core', aliases: ['elankav core', 'elan core', 'elankav-core'] },
  { id: 'elankav-platform', aliases: ['elankav platform', 'plataforma elankav', 'elankav-platform'] },
  { id: 'orchestrator', aliases: ['orchestrator', 'orquestador', 'elankav orchestrator'] },
  { id: 'connect', aliases: ['connect', 'elankav connect'] }
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

const PERMISSION_QUERY_PATTERN =
  /\b(permisos|accesos|capacidades|permitido|permitida|puedes|podes|podrias|puedo)\b/;

const INFORMATION_ONLY_PATTERN =
  /\b(solo informacion|no ejecutes|sin ejecutar|solo consulta|consulta solamente)\b/;

const TECHNICAL_ACTION_QUERY_PATTERN =
  /\b(service\.restart|service\.logs|git\.status|file\.inspect|test\.run|reiniciar|reinicia|restart|logs|git|tests?|pruebas?|deploy|archivo|repositorio)\b/;

const SELF_AUDIT_PATTERN = /\b(auditate|autoaudita|auto audita|audita tus capacidades|audita tus accesos|audita lo que puedes|audita lo que podes|revisa tus capacidades|revisa tus accesos|que te falta|que podes hacer realmente|que puedes hacer realmente|estado de tus capacidades)\b/;

function normalizeCommand(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function detectElanSelfAuditCommand(normalizedMessage) {
  if (!SELF_AUDIT_PATTERN.test(normalizedMessage)) return null;
  return Object.freeze({ type: OWNER_COMMANDS.SELF_AUDIT });
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

function resolveOwnerOpsFileAlias(normalizedMessage) {
  if (
    /\bowner[- ]language[- ]profile(?:\.json)?\b/.test(normalizedMessage) ||
    /\bperfil\b.*\blenguaje\b/.test(normalizedMessage)
  ) {
    return 'owner-language-profile';
  }

  if (/\bownercommandservice(?:\.js)?\b/.test(normalizedMessage)) {
    return 'orchestrator-owner-command';
  }

  if (/\bmessageservice(?:\.js)?\b/.test(normalizedMessage)) {
    return 'orchestrator-message-service';
  }

  if (/\bowneropsreadservice(?:\.js)?\b/.test(normalizedMessage)) {
    return 'orchestrator-owner-ops-read';
  }

  if (/\bowneropscapabilityregistry(?:\.js)?\b/.test(normalizedMessage)) {
    return 'orchestrator-owner-ops-registry';
  }

  return null;
}

function resolveOwnerOpsTestSuite(normalizedMessage) {
  if (
    /\bowner\s+language\b/.test(normalizedMessage) ||
    /\blanguage\s+profile\b/.test(normalizedMessage)
  ) {
    return 'orchestrator-owner-language';
  }

  if (/\bowner\s+business\b/.test(normalizedMessage)) {
    return 'orchestrator-owner-business';
  }

  if (/\bowner\s+ops\b/.test(normalizedMessage)) {
    return 'orchestrator-owner-ops';
  }

  return null;
}

function detectOwnerPermissionAuditCommand(normalizedMessage) {
  const asksPermissions =
    PERMISSION_QUERY_PATTERN.test(normalizedMessage);

  const informationOnly =
    INFORMATION_ONLY_PATTERN.test(normalizedMessage);

  const technicalQuestion =
    TECHNICAL_ACTION_QUERY_PATTERN.test(normalizedMessage);

  if (
    asksPermissions ||
    (informationOnly && technicalQuestion)
  ) {
    return Object.freeze({
      type: OWNER_COMMANDS.MODE_PERMISSIONS
    });
  }

  if (
    /\b(audita|auditar|revisa|revisar|muestra|mostra|mostrar)\b/.test(normalizedMessage) &&
    /\b(permisos|accesos)\b/.test(normalizedMessage)
  ) {
    return Object.freeze({
      type: OWNER_COMMANDS.MODE_PERMISSIONS
    });
  }

  return null;
}

function getCapabilityRisk(capability) {
  if (capability === 'code.prepare') {
    return 'LOW_RISK';
  }

  return getCapability(capability)?.risk || 'UNKNOWN';
}

function formatModePermissions(state) {
  const allowed =
    new Set(getModeTechnicalCapabilities(state.activeMode));

  const direct = [];
  const confirm = [];
  const blocked = [];

  for (const capability of TECHNICAL_OWNER_OPS_CAPABILITIES) {
    if (!allowed.has(capability)) {
      blocked.push(capability);
      continue;
    }

    const risk = getCapabilityRisk(capability);

    if (risk === 'CONFIRM_REQUIRED') {
      confirm.push(capability);
    } else {
      direct.push(capability);
    }
  }

  return [
    `Modo activo: ${state.activeMode}`,
    `Rol: ${state.role}`,
    '',
    'OWNER OPS — PERMITIDAS',
    ...(direct.length ? direct.map(value => `- ${value}`) : ['- Ninguna']),
    '',
    'OWNER OPS — REQUIEREN CONFIRMACIÓN',
    ...(confirm.length ? confirm.map(value => `- ${value}`) : ['- Ninguna']),
    '',
    'OWNER OPS — BLOQUEADAS EN ESTE MODO',
    ...(blocked.length ? blocked.map(value => `- ${value}`) : ['- Ninguna'])
  ].join('\n');
}

function formatTechnicalModeBlocked(state, capability) {
  return [
    '⛔ Operación bloqueada por modo.',
    '',
    `Modo activo: ${state.activeMode}`,
    `Capacidad solicitada: ${capability}`,
    '',
    'Las operaciones técnicas Owner OPS requieren modo PROGRAMADOR.',
    'No se ejecutó ni preparó ninguna operación.'
  ].join('\n');
}

async function checkTechnicalMode(capability) {
  const state = await getOperatorState({
    operatorId: 'owner',
    role: 'OWNER'
  });

  return {
    state,
    allowed: canUseModeCapability(
      state.activeMode,
      capability
    )
  };
}

function detectOwnerOpsReadCommand(normalizedMessage) {
  const target = resolveOwnerOpsTarget(normalizedMessage);

  const fileAlias = resolveOwnerOpsFileAlias(normalizedMessage);
  if (
    fileAlias &&
    /\b(archivo|file|contenido|perfil|revisa|revisar|lee|leer|mostra|mostrar|muestra)\b/.test(normalizedMessage)
  ) {
    return Object.freeze({
      type: OWNER_COMMANDS.OWNER_OPS_READ,
      capability: 'file.inspect',
      fileAlias
    });
  }

  const suite = resolveOwnerOpsTestSuite(normalizedMessage);
  if (
    suite &&
    /\b(test|tests|prueba|pruebas)\b/.test(normalizedMessage) &&
    /\b(ejecuta|ejecutar|corre|correr|lanza|lanzar|revisa|revisar)\b/.test(normalizedMessage)
  ) {
    return Object.freeze({
      type: OWNER_COMMANDS.OWNER_OPS_READ,
      capability: 'test.run',
      target: 'orchestrator',
      suite
    });
  }

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

  if (/\b(despliega|desplegar|deploy|despliegue)\b/.test(normalizedMessage)) {
    const commitMatch = String(message || '').match(/\b[0-9a-fA-F]{40}\b/);

    if (commitMatch) {
      const expectedCommit = commitMatch[0].toLowerCase();

      return Object.freeze({
        type: OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE,
        capability: 'repository.deploy',
        target,
        summary: `Desplegar ${target === 'connect' ? 'CONNECT' : 'Orchestrator'} al commit ${expectedCommit}`,
        impact: 'Se verificará el commit remoto exacto, solo se permitirá fast-forward, se creará backup, se actualizará el repositorio, se reiniciará el servicio y se verificará estado active.',
        parameters: Object.freeze({
          expectedCommit,
          restart: true,
          install: false
        })
      });
    }
  }

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

function detectOpsStatusCommand(message, normalizedMessage) {
  const match = String(message || '').toUpperCase().match(OPS_ID_PATTERN);

  if (!match || !JOB_STATUS_PATTERN.test(normalizedMessage)) {
    return null;
  }

  return Object.freeze({
    type: OWNER_COMMANDS.OPS_STATUS,
    operationId: `OPS-${match[1]}-${match[2]}`
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

  const languageLearnCommand =
    detectOwnerLanguageLearnCommand(message, normalized);

  if (languageLearnCommand) return languageLearnCommand;

  const confirmationCommand = detectOwnerOpsConfirmation(message);
  if (confirmationCommand) return confirmationCommand;

  const opsStatusCommand = detectOpsStatusCommand(message, normalized);
  if (opsStatusCommand) return opsStatusCommand;

  const selfAuditCommand = detectElanSelfAuditCommand(normalized);
  if (selfAuditCommand) return selfAuditCommand;

  const permissionCommand =
    detectOwnerPermissionAuditCommand(normalized);

  if (permissionCommand) return permissionCommand;

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

async function executeOwnerCommand({ command, platform, ownerPhone = null }) {
  const type = typeof command === 'string' ? command : command?.type;

  if (type === OWNER_COMMANDS.SELF_AUDIT) {
    const tracked = await runTrackedSelfAudit({ source: 'owner-command', ownerPhone });
    return {
      command: type,
      job: null,
      outputText: formatElanSelfAudit(tracked.report),
      selfAudit: tracked.report
    };
  }

  if (type === OWNER_COMMANDS.MODE_GET) {
    const state = await getOperatorState({ operatorId: 'owner', role: 'OWNER' });
    return { command: type, job: null, outputText: formatModeState(state), operatorMode: state };
  }
  if (type === OWNER_COMMANDS.MODE_SET) {
    const state = await setOperatorMode({ operatorId: 'owner', role: 'OWNER', mode: command.mode });
    return { command: type, job: null, outputText: `Modo operativo actualizado.\n${formatModeState(state)}`, operatorMode: state };
  }

  if (type === OWNER_COMMANDS.MODE_PERMISSIONS) {
    const state = await getOperatorState({
      operatorId: 'owner',
      role: 'OWNER'
    });

    return {
      command: type,
      job: null,
      outputText: formatModePermissions(state),
      operatorMode: state
    };
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
    const pending = await loadPendingOperation(
      command.operationId
    );

    if (
      isTechnicalOwnerOpsCapability(
        pending.operation.capability
      )
    ) {
      const access = await checkTechnicalMode(
        pending.operation.capability
      );

      if (!access.allowed) {
        return {
          command: type,
          job: pending.job,
          outputText: formatTechnicalModeBlocked(
            access.state,
            pending.operation.capability
          ),
          ownerOps: null
        };
      }
    }

    const result = await executeConfirmedOperation(
      command.operationId
    );

    return {
      command: type,
      job: result.job,
      outputText: formatSensitiveResult(result),
      ownerOps: result.execution
    };
  }
  if (type === OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE) {
    if (
      isTechnicalOwnerOpsCapability(command.capability)
    ) {
      const access = await checkTechnicalMode(
        command.capability
      );

      if (!access.allowed) {
        return {
          command: type,
          job: null,
          outputText: formatTechnicalModeBlocked(
            access.state,
            command.capability
          ),
          ownerOps: null
        };
      }
    }

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
    const access = await checkTechnicalMode(
      command.capability
    );

    if (!access.allowed) {
      return {
        command: type,
        job: null,
        outputText: formatTechnicalModeBlocked(
          access.state,
          command.capability
        ),
        ownerOps: null
      };
    }

    const result = await executeReadOperation(command);

    return {
      command: type,
      job: null,
      outputText: formatOwnerOpsResult(result),
      ownerOps: result
    };
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
  if (type === OWNER_COMMANDS.OPS_STATUS) {
    const result = await readDeferredOperationResult(
      command.operationId
    );

    if (result.status === 'pending') {
      return {
        command: type,
        job: null,
        outputText: [
          'Operación todavía en proceso.',
          '',
          `Operación: ${command.operationId}`,
          'Estado: pending'
        ].join('\n'),
        ownerOps: result
      };
    }

    if (result.status === 'failed') {
      return {
        command: type,
        job: null,
        outputText: [
          '❌ Operación fallida.',
          '',
          `Operación: ${command.operationId}`,
          `Error: ${result.error || 'SUPERVISOR_OPERATION_FAILED'}`
        ].join('\n'),
        ownerOps: result
      };
    }

    return {
      command: type,
      job: result.job,
      outputText: formatSensitiveResult(result),
      ownerOps: result.execution
    };
  }

  if (type === OWNER_COMMANDS.JOB_STATUS) {
    const job = await getJob(command.jobId);
    return { command: type, job, outputText: formatJobStatusResult(job) };
  }
  if (type === OWNER_COMMANDS.CODE_JOB) {
    return {
      command: type,
      job: null,
      outputText: [
        'Solicitud técnica detectada.',
        '',
        'La generación automática de código desde WhatsApp está deshabilitada por decisión del Owner.',
        'Las correcciones de código se preparan en la conversación de ChatGPT del Owner.',
        'Si una corrección requiere acceso al VPS, se ejecutará únicamente el bloque técnico preparado y revisado en ChatGPT.',
        '',
        'Orchestrator no creó Job de programación, no ejecutó Codex y no llamó a ningún generador automático de código.'
      ].join('\\n'),
      developmentHandoff: {
        platform: command.platform,
        task: command.task,
        automaticCodeGeneration: false
      }
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
  detectElanSelfAuditCommand,
  detectOwnerLanguageLearnCommand,
  detectOwnerModeCommand,
  detectOwnerOpsConfirmation,
  detectOwnerPermissionAuditCommand,
  detectOwnerOpsReadCommand,
  detectOwnerOpsSensitiveCommand,
  resolveOwnerOpsFileAlias,
  resolveOwnerOpsTestSuite,
  detectPreparedPublishCommand,
  detectSendDesignLinkCommand,
  executeOwnerCommand,
  formatContextSyncResult,
  formatCodeJobAccepted,
  formatJobStatusResult,
  resolvePlatformFromMessage
};
