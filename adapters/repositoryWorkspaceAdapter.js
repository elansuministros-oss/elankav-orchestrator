const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const WORKSPACES_ROOT = '/opt/elankav/workspaces';

async function runGit(args, options = {}) {
  const result = await execFileAsync(
    'git',
    args,
    {
      cwd: options.cwd,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function assertSafeJobId(jobId) {
  if (
    typeof jobId !== 'string' ||
    !/^JOB-[A-Za-z0-9-]+$/.test(jobId)
  ) {
    throw new Error('jobId no es seguro para crear workspace');
  }
}

function assertSafeBranch(branch) {
  if (
    typeof branch !== 'string' ||
    !/^job\/job-[a-z0-9-]+$/.test(branch)
  ) {
    throw new Error('rama temporal inválida');
  }
}

async function createRepositoryWorkspace({
  jobId,
  owner,
  repo,
  baseBranch,
  jobBranch
}) {
  assertSafeJobId(jobId);
  assertSafeBranch(jobBranch);

  if (!owner || !repo || !baseBranch) {
    throw new Error(
      'owner, repo y baseBranch son obligatorios'
    );
  }

  await fs.mkdir(WORKSPACES_ROOT, {
    recursive: true
  });

  const workspacePath = path.join(
    WORKSPACES_ROOT,
    jobId
  );

  try {
    await fs.access(workspacePath);

    throw new Error(
      `El workspace ya existe: ${workspacePath}`
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const repositoryUrl =
    `https://github.com/${owner}/${repo}.git`;

  await runGit([
    'clone',
    '--branch',
    baseBranch,
    '--single-branch',
    repositoryUrl,
    workspacePath
  ]);

  await runGit(
    [
      'checkout',
      '-b',
      jobBranch
    ],
    {
      cwd: workspacePath
    }
  );

  await runGit(
    [
      'push',
      '--set-upstream',
      'origin',
      jobBranch
    ],
    {
      cwd: workspacePath
    }
  );

  const currentBranch = (
    await runGit(
      ['branch', '--show-current'],
      { cwd: workspacePath }
    )
  ).stdout;

  const baseSha = (
    await runGit(
      ['rev-parse', 'HEAD'],
      { cwd: workspacePath }
    )
  ).stdout;

  const porcelain = (
    await runGit(
      ['status', '--porcelain'],
      { cwd: workspacePath }
    )
  ).stdout;

  if (currentBranch !== jobBranch) {
    throw new Error(
      `Rama activa inesperada: ${currentBranch}`
    );
  }

  if (porcelain) {
    throw new Error(
      'El workspace recién creado contiene cambios'
    );
  }

  return {
    healthy: true,
    repository: `${owner}/${repo}`,
    repositoryUrl,
    baseBranch,
    branch: jobBranch,
    baseSha,
    workspacePath,
    clean: true,
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  createRepositoryWorkspace,
  WORKSPACES_ROOT
};
