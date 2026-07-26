'use strict';

const adapter = require('../adapters/workspaceIntelligenceAdapter');

async function executeWorkspaceCapability(capability, input = {}) {
  switch (capability) {
    case 'workspace.list':
      return { workspaces: await adapter.listWorkspaces() };
    case 'workspace.inspect': {
      const workspace = await adapter.resolveWorkspace(input.workspaceId);
      const { workspacePath, directoryName, ...safe } = workspace;
      return safe;
    }
    case 'workspace.gitStatus': {
      const workspace = await adapter.resolveWorkspace(input.workspaceId);
      return { repository: workspace.repository, branch: workspace.branch, headSha: workspace.headSha, clean: workspace.clean, status: workspace.status };
    }
    case 'workspace.search':
      return adapter.searchText(input.workspaceId, input.query, input.paths || ['.'], input.limit);
    case 'workspace.read':
      return adapter.readTextFile(input.workspaceId, input.path, input.startLine, input.endLine);
    case 'workspace.diff':
      return adapter.getDiff(input.workspaceId, input.path);
    case 'workspace.packageManifest':
      return adapter.readPackageManifest(input.workspaceId);
    case 'workspace.prepare':
    case 'workspace.modify':
    case 'workspace.qa':
    case 'workspace.publish':
    case 'workspace.createPullRequest': {
      const error = new Error('Capability no habilitada en VSC-002A');
      error.code = 'CAPABILITY_NOT_ENABLED';
      throw error;
    }
    default: {
      const error = new Error('Capability desconocida');
      error.code = 'CAPABILITY_UNKNOWN';
      throw error;
    }
  }
}

module.exports = { executeWorkspaceCapability };
