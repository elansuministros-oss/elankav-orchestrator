const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const {
  executeWorkspaceQa
} = require('../adapters/qaAdapter');

const execFileAsync = promisify(execFile);

async function getGitValue(args, cwd) {
  const result = await execFileAsync(
    'git',
    args,
    {
      cwd,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  return result.stdout.trim();
}

async function runJobQa({
  job,
  workspace,
  changes
}) {
  if (!job?.id) {
    throw new Error('job requerido');
  }

  if (!workspace?.workspacePath) {
    throw new Error('workspace requerido');
  }

  if (!changes?.changed) {
    throw new Error(
      'No existen cambios para validar'
    );
  }

  const branchBefore = await getGitValue(
    ['branch', '--show-current'],
    workspace.workspacePath
  );

  const headBefore = await getGitValue(
    ['rev-parse', 'HEAD'],
    workspace.workspacePath
  );

  if (branchBefore !== job.branch) {
    throw new Error(
      `Rama activa inesperada: ${branchBefore}`
    );
  }

  const qa = await executeWorkspaceQa({
    workspacePath: workspace.workspacePath
  });

  const branchAfter = await getGitValue(
    ['branch', '--show-current'],
    workspace.workspacePath
  );

  const headAfter = await getGitValue(
    ['rev-parse', 'HEAD'],
    workspace.workspacePath
  );

  const statusAfter = await getGitValue(
    ['status', '--short'],
    workspace.workspacePath
  );

  if (branchAfter !== job.branch) {
    throw new Error(
      'QA cambió la rama activa'
    );
  }

  if (headAfter !== headBefore) {
    throw new Error(
      'QA creó o modificó commits'
    );
  }

  if (!statusAfter) {
    throw new Error(
      'Los cambios desaparecieron durante QA'
    );
  }

  return {
    healthy: true,
    branch: branchAfter,
    headBefore,
    headAfter,
    statusAfter,
    packageManager: qa.packageManager,
    buildScript: qa.buildScript,
    testScript: qa.testScript,
    checks: qa.results.map(result => ({
      command: result.command,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })),
    finishedAt: qa.finishedAt
  };
}

module.exports = {
  runJobQa
};
