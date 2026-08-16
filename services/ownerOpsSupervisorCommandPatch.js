'use strict';

const ownerCommands = require('./ownerCommandService');
const {
  readDeferredOperationResult
} = require('./ownerOpsSensitiveExecutor');

const ORIGINAL_DETECT = ownerCommands.detectOwnerCommand;
const ORIGINAL_EXECUTE = ownerCommands.executeOwnerCommand;
const STATUS_TYPE = 'owner_ops_supervisor_status';
const OPS_ID_PATTERN = /\bOPS-\d+-[A-Z0-9]{6}\b/i;
const COMMIT_PATTERN = /\b[0-9a-f]{40}\b/i;

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function detectTarget(text) {
  if (/\b(connect|elankav connect)\b/.test(text)) return 'connect';
  if (/\b(orchestrator|orquestador)\b/.test(text)) return 'orchestrator';
  return null;
}

function detectSupervisorCommand(message) {
  const raw = String(message || '');
  const normalized = normalize(raw);
  const ops = raw.toUpperCase().match(OPS_ID_PATTERN);

  if (ops && /\b(estado|estatus|resultado|verifica|verificar|consulta|consultar)\b/.test(normalized)) {
    return Object.freeze({ type: STATUS_TYPE, operationId: ops[0].toUpperCase() });
  }

  const target = detectTarget(normalized);
  if (
    target === 'orchestrator' &&
    /\b(reinicia|reiniciar|restart|rearranca|rearrancar)\b/.test(normalized)
  ) {
    return Object.freeze({
      type: ownerCommands.OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE,
      capability: 'service.restart',
      target: 'orchestrator',
      summary: 'Reiniciar Orchestrator',
      impact: 'El supervisor externo reiniciará Orchestrator y verificará que vuelva a estado active.',
      parameters: Object.freeze({})
    });
  }

  const commit = raw.match(COMMIT_PATTERN)?.[0]?.toLowerCase() || null;
  if (
    target && commit &&
    /\b(despliega|desplegar|deploy|actualiza|actualizar)\b/.test(normalized)
  ) {
    const cleanGeneratedCatalog = target === 'connect' && /\b(limpia|limpiar|limpieza|restaura|restaurar)\b/.test(normalized);
    return Object.freeze({
      type: ownerCommands.OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE,
      capability: 'repository.deploy',
      target,
      summary: cleanGeneratedCatalog
        ? `Limpiar catálogo generado y desplegar CONNECT al commit ${commit.slice(0, 7)}`
        : `Desplegar ${target === 'connect' ? 'CONNECT' : 'Orchestrator'} al commit ${commit.slice(0, 7)}`,
      impact: target === 'connect'
        ? cleanGeneratedCatalog
          ? 'El supervisor verificará que el único cambio local sea el catálogo generado autorizado, guardará respaldo, restaurará únicamente ese archivo al HEAD actual, exigirá repositorio limpio y después hará fast-forward al commit remoto exacto, npm ci, build, reinicio y verificación del puerto 4400.'
          : 'Se exige repositorio limpio, fast-forward, commit remoto exacto, backup previo, npm ci con dependencias de desarrollo, build TypeScript, reinicio y verificación del servicio y puerto 4400.'
        : 'Se exige repositorio limpio, fast-forward, commit remoto exacto, backup previo, instalación de dependencias y verificación del servicio. El supervisor externo se refrescará automáticamente después del despliegue.',
      parameters: Object.freeze({
        expectedCommit: commit,
        install: true,
        restart: true,
        ...(cleanGeneratedCatalog ? { cleanGeneratedCatalog: true } : {})
      })
    });
  }

  return null;
}

function detectOwnerCommand(message) {
  return detectSupervisorCommand(message) || ORIGINAL_DETECT(message);
}

function formatSupervisorStatus(result) {
  if (!result || result.status === 'pending') {
    return `Operación ${result?.id || 'OPS'} todavía pendiente en el supervisor externo.`;
  }
  if (result.status === 'failed') {
    return [
      '❌ Operación del supervisor finalizada con error.',
      '',
      `Operación: ${result.id}`,
      `Error: ${result.error || 'SUPERVISOR_OPERATION_FAILED'}`,
      'No se forzó ningún cambio fuera de la política permitida.'
    ].join('\n');
  }

  const execution = result.execution || {};
  return [
    '✅ Resultado verificado del supervisor externo.',
    '',
    `Operación: ${result.id}`,
    `Acción: ${execution.capability || 'completada'}`,
    `Objetivo: ${execution.target || 'no disponible'}`,
    execution.cleanedGeneratedCatalog ? 'Catálogo generado local: respaldado y restaurado de forma controlada' : null,
    execution.cleanupBackup ? `Respaldo catálogo local: ${execution.cleanupBackup}` : null,
    execution.after ? `Commit activo: ${execution.after}` : null,
    execution.backup ? `Backup: ${execution.backup}` : null,
    execution.installCommand ? `Dependencias: ${execution.installCommand}` : null,
    execution.buildCommand ? `Build: ${execution.buildCommand}` : null,
    execution.service ? `Servicio: ${execution.service}` : null,
    execution.status ? `Estado: ${execution.status}` : null,
    execution.listening ? `Puerto verificado: ${execution.listening}` : null
  ].filter(Boolean).join('\n');
}

async function executeOwnerCommand(input) {
  const command = input?.command;
  if (command?.type === STATUS_TYPE) {
    const result = await readDeferredOperationResult(command.operationId);
    return {
      command: STATUS_TYPE,
      job: result.job || null,
      outputText: formatSupervisorStatus(result),
      ownerOps: result
    };
  }
  return ORIGINAL_EXECUTE(input);
}

ownerCommands.detectOwnerCommand = detectOwnerCommand;
ownerCommands.executeOwnerCommand = executeOwnerCommand;

module.exports = {
  STATUS_TYPE,
  detectOwnerCommand,
  detectSupervisorCommand,
  formatSupervisorStatus
};
