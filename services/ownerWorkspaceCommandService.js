'use strict';

const { executeElanAIWorkspaceQuery } = require('./elanAIWorkspaceBridgeService');

const WORKSPACE_OWNER_COMMANDS = Object.freeze({
  SEARCH: 'workspace_search',
  READ: 'workspace_read',
  DIFF: 'workspace_diff',
  GIT_STATUS: 'workspace_git_status',
  PACKAGE: 'workspace_package_manifest'
});

const WORKSPACE_ALIASES = Object.freeze([
  { id: 'elanvisual', aliases: ['elanvisual', 'elan visual'] },
  { id: 'elanpet', aliases: ['elanpet', 'elan pet'] },
  { id: 'elanhome', aliases: ['elanhome', 'elan home'] },
  { id: 'elan-ai', aliases: ['elan ia', 'elan ai', 'elan-ai'] },
  { id: 'connect', aliases: ['connect', 'elankav connect'] },
  { id: 'orchestrator', aliases: ['orchestrator', 'elankav orchestrator'] },
  { id: 'elankav-platform', aliases: ['elankav platform', 'plataforma elankav'] },
  { id: 'elankav-core', aliases: ['elankav core', 'elan core'] }
]);

const MUTATION_INTENT_PATTERN = /\b(modifica|modificar|cambia|cambiar|actualiza|actualizar|edita|editar|elimina|eliminar|borra|borrar|crea|crear|escribe|escribir|reemplaza|reemplazar|corrige|corregir|implementa|implementar)\b/;

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function resolveWorkspaceId(message) {
  const normalized = normalize(message);
  for (const workspace of WORKSPACE_ALIASES) {
    if (workspace.aliases.some(alias => normalized.includes(alias))) return workspace.id;
  }
  return null;
}

function cleanSearchQuery(value) {
  return String(value || '')
    .trim()
    .replace(/^[`'\"]+|[`'\".?!]+$/g, '')
    .replace(/\s+(?:en|dentro de)\s+(?:el\s+)?(?:repositorio\s+)?(?:elanvisual|elan visual|elanpet|elan pet|elanhome|elan home|elan ia|elan ai|elan-ai|connect|elankav connect|orchestrator|elankav orchestrator|elankav platform|plataforma elankav|elankav core|elan core)\s*$/i, '')
    .trim();
}

function extractSearchQuery(message) {
  const normalized = normalize(message);
  if (MUTATION_INTENT_PATTERN.test(normalized)) return null;
  const match = String(message || '').match(/\b(?:busca|buscar|buscame|búscame|encuentra|encontrar|localiza|localizar)\b\s+(?:el\s+texto\s+|la\s+funcion\s+|la\s+función\s+|el\s+simbolo\s+|el\s+símbolo\s+)?(.+)/i);
  return match ? cleanSearchQuery(match[1]) : null;
}

function extractPath(message) {
  const explicit = String(message || '').match(/(?:archivo|file)\s+[`'\"]?([^`'\"\s]+)[`'\"]?/i);
  if (explicit) return explicit[1].replace(/[.,;:!?]+$/, '');
  const generic = String(message || '').match(/[`'\"]?([\w./-]+\.(?:json|cjs|mjs|tsx|jsx|yaml|html|js|ts|md|txt|yml|css|sql))[`'\"]?/i);
  return generic ? generic[1].replace(/[.,;:!?]+$/, '') : null;
}

function detectWorkspaceOwnerCommand(message) {
  const normalized = normalize(message);
  if (MUTATION_INTENT_PATTERN.test(normalized)) return null;

  const workspaceId = resolveWorkspaceId(message);

  const searchQuery = extractSearchQuery(message);
  if (searchQuery) {
    return Object.freeze({
      type: WORKSPACE_OWNER_COMMANDS.SEARCH,
      workspaceId,
      query: searchQuery
    });
  }

  const path = extractPath(message);
  if (path && /\b(lee|leer|muestra|mostrar|abre|abrir|contenido)\b/.test(normalized)) {
    return Object.freeze({ type: WORKSPACE_OWNER_COMMANDS.READ, workspaceId, path });
  }

  if (/\b(?:estado|status)\s+(?:de\s+)?git\b|\bgit\s+(?:status|estado)\b|\brama\s+(?:actual\s+)?(?:de|del)\b/.test(normalized)) {
    return Object.freeze({ type: WORKSPACE_OWNER_COMMANDS.GIT_STATUS, workspaceId });
  }

  if (/\b(diff|diferencias|cambios locales|cambios pendientes)\b/.test(normalized)) {
    return Object.freeze({ type: WORKSPACE_OWNER_COMMANDS.DIFF, workspaceId, path: path || undefined });
  }

  if (/\b(package\.json|dependencias|scripts npm|manifest(?:o)? del proyecto)\b/.test(normalized)) {
    return Object.freeze({ type: WORKSPACE_OWNER_COMMANDS.PACKAGE, workspaceId });
  }

  return null;
}

function formatSearchResults(query, results) {
  const matches = results.flatMap(result => (result.data?.matches || []).map(match => ({
    workspace: result.workspace,
    ...match
  })));

  if (!matches.length) return `No encontré coincidencias para ${query} en los workspaces disponibles.`;

  const lines = [`Encontré ${matches.length} coincidencia(s) para ${query}.`, ''];
  matches.slice(0, 20).forEach((match, index) => {
    lines.push(`${index + 1}. ${match.workspace} — ${match.path}:${match.line}`);
    if (match.preview) lines.push(`   ${match.preview}`);
  });
  if (matches.length > 20) lines.push('', `Mostrando 20 de ${matches.length} coincidencias.`);
  return lines.join('\n');
}

async function resolveTargetWorkspaces(workspaceId) {
  if (workspaceId) return [{ id: workspaceId, repository: workspaceId }];
  const listed = await executeElanAIWorkspaceQuery({ intent: 'list_workspaces', actor: { id: 'elan-ai-owner-router', type: 'service', channel: 'whatsapp' } });
  if (!listed.success) throw Object.assign(new Error(listed.error?.message || 'No fue posible listar workspaces'), { code: listed.error?.code });
  return (listed.data?.workspaces || []).map(item => ({ id: item.id || item.directoryName || item.repository, repository: item.repository || item.id }));
}

async function executeWorkspaceOwnerCommand(command) {
  const actor = { id: 'elan-ai-owner-router', type: 'service', channel: 'whatsapp' };

  if (command.type === WORKSPACE_OWNER_COMMANDS.SEARCH) {
    const workspaces = await resolveTargetWorkspaces(command.workspaceId);
    const results = [];
    for (const workspace of workspaces) {
      const result = await executeElanAIWorkspaceQuery({
        intent: 'search_code',
        workspaceId: workspace.id,
        query: command.query,
        limit: 20,
        actor
      });
      if (result.success) results.push({ workspace: workspace.repository || workspace.id, ...result });
    }
    return {
      command: command.type,
      job: null,
      outputText: formatSearchResults(command.query, results),
      workspaceQuery: { query: command.query, workspaces: workspaces.length, results }
    };
  }

  if (!command.workspaceId) {
    return {
      command: command.type,
      job: null,
      outputText: 'Indicame en cuál repositorio o workspace querés realizar esa consulta.'
    };
  }

  const intentByType = {
    [WORKSPACE_OWNER_COMMANDS.READ]: 'read_file',
    [WORKSPACE_OWNER_COMMANDS.DIFF]: 'workspace_diff',
    [WORKSPACE_OWNER_COMMANDS.GIT_STATUS]: 'git_status',
    [WORKSPACE_OWNER_COMMANDS.PACKAGE]: 'package_manifest'
  };
  const result = await executeElanAIWorkspaceQuery({
    intent: intentByType[command.type],
    workspaceId: command.workspaceId,
    path: command.path,
    actor
  });

  if (!result.success) {
    return { command: command.type, job: null, outputText: `No pude completar la consulta: ${result.error?.message || 'error de workspace'}.`, workspaceQuery: result };
  }

  if (command.type === WORKSPACE_OWNER_COMMANDS.READ) {
    const data = result.data || {};
    return { command: command.type, job: null, outputText: [`${command.workspaceId}/${data.path}`, `Líneas ${data.startLine}-${data.endLine} de ${data.totalLines}`, '', data.content].join('\n'), workspaceQuery: result };
  }
  if (command.type === WORKSPACE_OWNER_COMMANDS.DIFF) {
    return { command: command.type, job: null, outputText: result.data?.content || 'El workspace no tiene diferencias locales.', workspaceQuery: result };
  }
  if (command.type === WORKSPACE_OWNER_COMMANDS.GIT_STATUS) {
    const data = result.data || {};
    const statusLines = Array.isArray(data.status) ? data.status : [];
    return {
      command: command.type,
      job: null,
      outputText: [
        `Workspace: ${command.workspaceId}`,
        `Repositorio: ${data.repository || 'No definido'}`,
        `Rama: ${data.branch || 'No definida'}`,
        `Commit: ${data.headSha || 'No definido'}`,
        `Estado: ${data.clean ? 'limpio' : 'con cambios locales'}`,
        ...(statusLines.length ? ['', ...statusLines] : [])
      ].join('\n'),
      workspaceQuery: result
    };
  }

  const manifest = result.data || {};
  return {
    command: command.type,
    job: null,
    outputText: [
      `Manifest de ${command.workspaceId}`,
      `Nombre: ${manifest.name || 'No definido'}`,
      `Versión: ${manifest.version || 'No definida'}`,
      `Scripts: ${Object.keys(manifest.scripts || {}).join(', ') || 'Ninguno'}`,
      `Dependencias: ${(manifest.dependencies || []).join(', ') || 'Ninguna'}`
    ].join('\n'),
    workspaceQuery: result
  };
}

module.exports = {
  WORKSPACE_OWNER_COMMANDS,
  detectWorkspaceOwnerCommand,
  executeWorkspaceOwnerCommand,
  extractPath,
  extractSearchQuery,
  resolveWorkspaceId
};
