const { getVscodeRuntimeStatus } = require('../adapters/vscodeAdapter');

const VSCODE_SERVICE_ID = 'vscode-web';
const REQUIRED_PERMISSION = 'vscode.workspaces.read';

function getConfiguredWorkspaces() {
  const workspaceRoot = String(
    process.env.VSCODE_WORKSPACE_ROOT || '/opt/elankav/workspaces'
  ).trim();

  return [
    {
      id: 'elankav-workspaces',
      name: 'ELANKAV Workspaces',
      root: workspaceRoot,
      mode: 'read-only-metadata'
    }
  ];
}

async function getVscodeServiceStatus({
  actor = null,
  hasPermission = false,
  runtimeStatusProvider = getVscodeRuntimeStatus
} = {}) {
  if (!hasPermission) {
    const error = new Error('VSCODE_ACCESS_DENIED');
    error.code = 'VSCODE_ACCESS_DENIED';
    throw error;
  }

  const runtime = await runtimeStatusProvider();

  return {
    service: VSCODE_SERVICE_ID,
    state: runtime.healthy ? 'AVAILABLE' : 'UNAVAILABLE',
    phase: 'VSC-001',
    accessMode: 'read-only',
    actor,
    requiredPermission: REQUIRED_PERMISSION,
    runtime,
    workspaces: getConfiguredWorkspaces(),
    restrictions: {
      directGithub: false,
      directDocker: false,
      directSupabase: false,
      directWaha: false,
      directProduction: false,
      shellExecution: false,
      fileMutation: false
    }
  };
}

module.exports = {
  REQUIRED_PERMISSION,
  getConfiguredWorkspaces,
  getVscodeServiceStatus
};
