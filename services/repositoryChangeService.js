const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const {
  modifyWorkspaceWithNativeAI
} = require('./nativeCodeExecutorService');

const execFileAsync = promisify(execFile);

async function runGit(args, cwd) {
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

async function applyJobChanges({
  job,
  workspace
}) {
  if (!job?.task) {
    throw new Error('job requerido');
  }

  if (!workspace?.workspacePath) {
    throw new Error('workspace requerido');
  }

  const branchBefore = await runGit(
    ['branch', '--show-current'],
    workspace.workspacePath
  );

  if (branchBefore !== job.branch) {
    throw new Error(
      `Rama activa inesperada: ${branchBefore}`
    );
  }

  const headBefore = await runGit(
    ['rev-parse', 'HEAD'],
    workspace.workspacePath
  );

  const executorResult = await modifyWorkspaceWithNativeAI({
    task: job.task,
    workspacePath: workspace.workspacePath
  });

  if (!executorResult.healthy) {
    throw new Error(
      executorResult.error ||
      'ELAN Native Code no pudo modificar el workspace'
    );
  }

  const branchAfter = await runGit(
    ['branch', '--show-current'],
    workspace.workspacePath
  );

  const headAfter = await runGit(
    ['rev-parse', 'HEAD'],
    workspace.workspacePath
  );

  const status = await runGit(
    ['status', '--short'],
    workspace.workspacePath
  );

  const diffStat = await runGit(
    ['diff', '--stat'],
    workspace.workspacePath
  );

  const diffCheck = await execFileAsync(
    'git',
    ['diff', '--check'],
    {
      cwd: workspace.workspacePath,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  if (branchAfter !== job.branch) {
    throw new Error(
      'ELAN Native Code cambió la rama activa'
    );
  }

  if (headAfter !== headBefore) {
    throw new Error(
      'ELAN Native Code creó o movió un commit'
    );
  }

  return {
    healthy: true,
    workspacePath: workspace.workspacePath,
    branch: branchAfter,
    headBefore,
    headAfter,
    changed: Boolean(status),
    status,
    diffStat,
    diffCheck: diffCheck.stdout.trim(),
    executor: {
      engine: executorResult.engine,
      model: executorResult.model,
      responseId: executorResult.responseId,
      usage: executorResult.usage,
      changedFiles: executorResult.changedFiles,
      contextFiles: executorResult.contextFiles,
      contextChars: executorResult.contextChars,
      summary: executorResult.summary
    },
    finishedAt: new Date().toISOString()
  };
}

module.exports = {
  applyJobChanges
};
