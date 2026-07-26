'use strict';

const { invokeWorkspaceTool } = require('./workspaceToolContractService');

const INTENTS = Object.freeze({
  LIST: 'list_workspaces',
  INSPECT: 'inspect_workspace',
  GIT_STATUS: 'git_status',
  SEARCH: 'search_code',
  READ: 'read_file',
  DIFF: 'workspace_diff',
  PACKAGE: 'package_manifest'
});

const CAPABILITY_BY_INTENT = Object.freeze({
  [INTENTS.LIST]: 'workspace.list',
  [INTENTS.INSPECT]: 'workspace.inspect',
  [INTENTS.GIT_STATUS]: 'workspace.gitStatus',
  [INTENTS.SEARCH]: 'workspace.search',
  [INTENTS.READ]: 'workspace.read',
  [INTENTS.DIFF]: 'workspace.diff',
  [INTENTS.PACKAGE]: 'workspace.packageManifest'
});

function normalizeRequest(input = {}) {
  const intent = String(input.intent || '').trim();
  const capability = CAPABILITY_BY_INTENT[intent];
  if (!capability) {
    const error = new Error('Intención de workspace no soportada');
    error.code = 'WORKSPACE_INTENT_UNSUPPORTED';
    throw error;
  }

  return {
    capability,
    workspaceId: input.workspaceId ? String(input.workspaceId).trim() : undefined,
    path: input.path ? String(input.path).trim() : undefined,
    query: input.query ? String(input.query).trim() : undefined,
    paths: Array.isArray(input.paths) ? input.paths.map(value => String(value).trim()).filter(Boolean) : undefined,
    startLine: input.startLine,
    endLine: input.endLine,
    limit: input.limit,
    actor: {
      id: String(input.actor?.id || 'elan-ai').trim(),
      type: String(input.actor?.type || 'service').trim(),
      channel: input.actor?.channel || 'internal'
    },
    requestId: input.requestId
  };
}

function formatResult(intent, result) {
  if (!result?.success) return result;
  const data = result.data;
  if (intent === INTENTS.LIST) {
    return { ...result, summary: `${data.workspaces?.length || 0} workspace(s) disponibles` };
  }
  if (intent === INTENTS.SEARCH) {
    return { ...result, summary: `${data.matches?.length || 0} coincidencia(s) encontradas` };
  }
  if (intent === INTENTS.GIT_STATUS) {
    return { ...result, summary: data.clean ? 'Workspace limpio' : 'Workspace con cambios locales' };
  }
  return result;
}

async function executeElanAIWorkspaceQuery(input = {}) {
  const normalized = normalizeRequest(input);
  const result = await invokeWorkspaceTool(normalized);
  return formatResult(String(input.intent || '').trim(), result);
}

module.exports = {
  INTENTS,
  CAPABILITY_BY_INTENT,
  normalizeRequest,
  executeElanAIWorkspaceQuery
};
