const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

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

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function publishWorkspaceChanges({
  workspacePath,
  expectedBranch,
  commitMessage
}) {
  if (!workspacePath) {
    throw new Error('workspacePath requerido');
  }

  if (!expectedBranch) {
    throw new Error('expectedBranch requerido');
  }

  if (!commitMessage) {
    throw new Error('commitMessage requerido');
  }

  const branchBefore = (
    await runGit(
      ['branch', '--show-current'],
      workspacePath
    )
  ).stdout;

  if (branchBefore !== expectedBranch) {
    throw new Error(
      `Rama activa inesperada: ${branchBefore}`
    );
  }

  if (
    expectedBranch === 'main' ||
    expectedBranch === 'master'
  ) {
    throw new Error(
      'Publicación bloqueada sobre rama protegida'
    );
  }

  if (!expectedBranch.startsWith('job/')) {
    throw new Error(
      'Solo se permiten ramas temporales job/*'
    );
  }

  const headBefore = (
    await runGit(
      ['rev-parse', 'HEAD'],
      workspacePath
    )
  ).stdout;

  const statusBefore = (
    await runGit(
      ['status', '--short'],
      workspacePath
    )
  ).stdout;

  if (!statusBefore) {
    throw new Error(
      'No existen cambios para publicar'
    );
  }

  await runGit(
    ['diff', '--check'],
    workspacePath
  );

  await runGit(
    ['add', '--all'],
    workspacePath
  );

  const stagedStatus = (
    await runGit(
      ['diff', '--cached', '--name-status'],
      workspacePath
    )
  ).stdout;

  if (!stagedStatus) {
    throw new Error(
      'No existen cambios preparados para commit'
    );
  }

  await runGit(
    [
      '-c',
      'user.name=ELANKAV Orchestrator',
      '-c',
      'user.email=orchestrator@elankav.local',
      'commit',
      '-m',
      commitMessage
    ],
    workspacePath
  );

  const headAfter = (
    await runGit(
      ['rev-parse', 'HEAD'],
      workspacePath
    )
  ).stdout;

  if (headAfter === headBefore) {
    throw new Error(
      'El commit no modificó HEAD'
    );
  }

  const branchAfter = (
    await runGit(
      ['branch', '--show-current'],
      workspacePath
    )
  ).stdout;

  if (branchAfter !== expectedBranch) {
    throw new Error(
      'La rama cambió durante el commit'
    );
  }

  await runGit(
    [
      'push',
      'origin',
      `HEAD:${expectedBranch}`
    ],
    workspacePath
  );

  const remoteHead = (
    await runGit(
      [
        'ls-remote',
        '--heads',
        'origin',
        expectedBranch
      ],
      workspacePath
    )
  ).stdout
    .split(/\s+/)[0];

  if (remoteHead !== headAfter) {
    throw new Error(
      'El SHA remoto no coincide con el commit local'
    );
  }

  const statusAfter = (
    await runGit(
      ['status', '--short'],
      workspacePath
    )
  ).stdout;

  if (statusAfter) {
    throw new Error(
      'El workspace no quedó limpio tras publicar'
    );
  }

  return {
    healthy: true,
    branch: branchAfter,
    headBefore,
    commitSha: headAfter,
    remoteSha: remoteHead,
    stagedFiles: stagedStatus,
    clean: true,
    pushed: true,
    commitMessage,
    finishedAt: new Date().toISOString()
  };
}

module.exports = {
  publishWorkspaceChanges
};
