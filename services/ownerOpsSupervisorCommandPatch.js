'use strict';

const ownerCommands = require('./ownerCommandService');
const { readDeferredOperationResult } = require('./ownerOpsSensitiveExecutor');

const ORIGINAL_DETECT = ownerCommands.detectOwnerCommand;
const ORIGINAL_EXECUTE = ownerCommands.executeOwnerCommand;
const STATUS_TYPE = 'owner_ops_supervisor_status';
const OPS_ID_PATTERN = /\bOPS-\d+-[A-Z0-9]{6}\b/i;
const COMMIT_PATTERN = /\b[0-9a-f]{40}\b/i;

const DEPLOY_TARGETS = Object.freeze({
  connect: Object.freeze({ label: 'CONNECT' }),
  orchestrator: Object.freeze({ label: 'Orchestrator' }),
  elanvisual: Object.freeze({
    label: 'ELANVISUAL',
    repositoryFullName: 'elansuministros-oss/elanvisual-platform',
    canonicalBranch: 'elanvisual-desde-elanpet'
  })
});

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function explicitTarget(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  for (const line of lines) {
    const normalized = normalize(line);
    if (!/^(repositorio(?: exacto)?|objetivo(?: exacto)?|target)\s*:/.test(normalized)) continue;
    if (/elanvisual-platform|\belanvisual\b/.test(normalized)) return 'elanvisual';
    if (/elankav-orchestrator|\borchestrator\b|\borquestador\b/.test(normalized)) return 'orchestrator';
    if (/elankav-connect|\bconnect\b/.test(normalized)) return 'connect';
  }
  return null;
}

function stripNegativeActions(raw) {
  return normalize(raw)
    .replace(/\bno\s+(?:despliegues?|desplegar|reinicies?|reiniciar|reinicia|toques?|tocar|modifiques?|modificar)\s+(?:el\s+)?connect\b/g, '')
    .replace(/\bno\s+(?:despliegues?|desplegar|reinicies?|reiniciar|reinicia|toques?|tocar|modifiques?|modificar)\s+(?:el\s+)?(?:orchestrator|orquestador)\b/g, '')
    .replace(/\bno\s+(?:despliegues?|desplegar|reinicies?|reiniciar|reinicia|toques?|tocar|modifiques?|modificar)\s+(?:el\s+)?(?:elanvisual|elanvisual-platform)\b/g, '')
    .replace(/\bno\s+(?:reinicies?|reiniciar|reinicia|toques?|tocar)\s+(?:el\s+)?waha\b(?:\s+directamente)?/g, '');
}

function detectTarget(raw) {
  const explicit = explicitTarget(raw);
  if (explicit) return explicit;

  const text = stripNegativeActions(raw);
  const matches = [
    /\b(connect|elankav connect)\b/.test(text) ? 'connect' : null,
    /\b(orchestrator|orquestador)\b/.test(text) ? 'orchestrator' : null,
    /\b(elanvisual|elanvisual-platform)\b/.test(text) ? 'elanvisual' : null
  ].filter(Boolean);

  return matches.length === 1 ? matches[0] : null;
}

function detectSupervisorCommand(message) {
  const raw = String(message || '');
  const normalized = normalize(raw);
  const operationalText = stripNegativeActions(raw);
  const ops = raw.toUpperCase().match(OPS_ID_PATTERN);

  if (ops && /\b(estado|estatus|resultado|verifica|verificar|consulta|consultar)\b/.test(normalized)) {
    return Object.freeze({ type: STATUS_TYPE, operationId: ops[0].toUpperCase() });
  }

  const target = detectTarget(raw);
  const commit = raw.match(COMMIT_PATTERN)?.[0]?.toLowerCase() || null;

  // A deploy command with an exact commit always wins over incidental wording
  // such as "No reiniciar WAHA". Otherwise a safety sentence can be mistaken
  // for a restart request.
  if (target && commit && /\b(despliega|desplegar|deploy|actualiza|actualizar)\b/.test(operationalText)) {
    const targetConfig = DEPLOY_TARGETS[target];
    const cleanGeneratedCatalog = target === 'connect' && /\b(limpia|limpiar|limpieza|restaura|restaurar)\b/.test(operationalText);
    const parameters = {
      expectedCommit: commit,
      install: true,
      restart: target !== 'elanvisual'
    };

    if (cleanGeneratedCatalog) parameters.cleanGeneratedCatalog = true;
    if (targetConfig?.repositoryFullName) parameters.repositoryFullName = targetConfig.repositoryFullName;
    if (targetConfig?.canonicalBranch) parameters.canonicalBranch = targetConfig.canonicalBranch;

    const impact = target === 'connect'
      ? cleanGeneratedCatalog
        ? 'El supervisor verificará que el único cambio local sea el catálogo generado autorizado, guardará respaldo, restaurará únicamente ese archivo al HEAD actual, exigirá repositorio limpio y después hará fast-forward al commit remoto exacto, npm ci, build, reinicio y verificación del puerto 4400.'
        : 'Se exige repositorio limpio, fast-forward, commit remoto exacto, backup previo, npm ci con dependencias de desarrollo, build TypeScript, reinicio y verificación del servicio y puerto 4400.'
      : target === 'elanvisual'
        ? 'El supervisor debe desplegar exclusivamente ELANVISUAL desde el repositorio y rama canónicos indicados, al commit remoto exacto, sin tocar CONNECT, Orchestrator ni WAHA.'
        : 'Se exige repositorio limpio, fast-forward, commit remoto exacto, backup previo, instalación de dependencias y verificación del servicio. El supervisor externo se refrescará automáticamente después del despliegue.';

    return Object.freeze({
      type: ownerCommands.OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE,
      capability: 'repository.deploy',
      target,
      summary: cleanGeneratedCatalog
        ? `Limpiar catálogo generado y desplegar CONNECT al commit ${commit.slice(0, 7)}`
        : `Desplegar ${targetConfig?.label || target} al commit ${commit.slice(0, 7)}`,
      impact,
      parameters: Object.freeze(parameters)
    });
  }

  if (target === 'orchestrator' && /\b(reinicia|reiniciar|restart|rearranca|rearrancar)\b/.test(operationalText)) {
    return Object.freeze({
      type: ownerCommands.OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE,
      capability: 'service.restart', target: 'orchestrator', summary: 'Reiniciar Orchestrator',
      impact: 'El supervisor externo reiniciará Orchestrator y verificará que vuelva a estado active.', parameters: Object.freeze({})
    });
  }

  return null;
}

function detectOwnerCommand(message) { return detectSupervisorCommand(message) || ORIGINAL_DETECT(message); }

function formatSupervisorStatus(result) {
  if (!result || result.status === 'pending') return `Operación ${result?.id || 'OPS'} todavía pendiente en el supervisor externo.`;
  if (result.status === 'failed') return ['❌ Operación del supervisor finalizada con error.','',`Operación: ${result.id}`,`Error: ${result.error || 'SUPERVISOR_OPERATION_FAILED'}`,'No se forzó ningún cambio fuera de la política permitida.'].join('\n');
  const execution = result.execution || {};
  return ['✅ Resultado verificado del supervisor externo.','',`Operación: ${result.id}`,`Acción: ${execution.capability || 'completada'}`,`Objetivo: ${execution.target || 'no disponible'}`,
    execution.cleanedGeneratedCatalog ? 'Catálogo generado local: respaldado y restaurado de forma controlada' : null,
    execution.cleanupBackup ? `Respaldo catálogo local: ${execution.cleanupBackup}` : null,
    execution.after ? `Commit activo: ${execution.after}` : null, execution.backup ? `Backup: ${execution.backup}` : null,
    execution.installCommand ? `Dependencias: ${execution.installCommand}` : null, execution.buildCommand ? `Build: ${execution.buildCommand}` : null,
    execution.service ? `Servicio: ${execution.service}` : null, execution.status ? `Estado: ${execution.status}` : null,
    execution.listening ? `Puerto verificado: ${execution.listening}` : null,
    execution.whatsappCoreProtected === true ? 'WhatsApp Core: PROTECTED' : null,
    execution.whatsappCoreContract ? `Contrato WhatsApp: ${execution.whatsappCoreContract}` : null,
    execution.healthEndpoint ? 'Orchestrator health: OK' : null, execution.bridgeEndpoint ? 'WAHA inbound bridge: READY' : null
  ].filter(Boolean).join('\n');
}

async function executeOwnerCommand(input) {
  const command = input?.command;
  if (command?.type === STATUS_TYPE) {
    const result = await readDeferredOperationResult(command.operationId);
    return { command: STATUS_TYPE, job: result.job || null, outputText: formatSupervisorStatus(result), ownerOps: result };
  }
  return ORIGINAL_EXECUTE(input);
}

ownerCommands.detectOwnerCommand = detectOwnerCommand;
ownerCommands.executeOwnerCommand = executeOwnerCommand;

module.exports = {
  STATUS_TYPE,
  DEPLOY_TARGETS,
  detectOwnerCommand,
  detectSupervisorCommand,
  detectTarget,
  explicitTarget,
  formatSupervisorStatus,
  stripNegativeActions
};
