const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function runGh(args, cwd) {
  const result = await execFileAsync(
    'gh',
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

function assertSafeBranch(branch, label) {
  if (!branch || typeof branch !== 'string') {
    throw new Error(`${label} requerida`);
  }

  if (
    label === 'headBranch' &&
    !branch.startsWith('job/')
  ) {
    throw new Error(
      'El Pull Request debe originarse en una rama job/*'
    );
  }

  if (
    label === 'baseBranch' &&
    (
      branch === 'main' ||
      branch === 'master'
    )
  ) {
    throw new Error(
      'Pull Request directo a main/master bloqueado'
    );
  }
}

async function findExistingPullRequest({
  repository,
  headBranch,
  baseBranch,
  cwd
}) {
  const result = await runGh(
    [
      'pr',
      'list',
      '--repo',
      repository,
      '--head',
      headBranch,
      '--base',
      baseBranch,
      '--state',
      'open',
      '--json',
      'number,url,title,headRefName,baseRefName'
    ],
    cwd
  );

  const pullRequests = JSON.parse(
    result.stdout || '[]'
  );

  return pullRequests[0] || null;
}

async function createPullRequest({
  repository,
  workspacePath,
  headBranch,
  baseBranch,
  title,
  body
}) {
  if (!repository) {
    throw new Error('repository requerido');
  }

  if (!workspacePath) {
    throw new Error('workspacePath requerido');
  }

  if (!title) {
    throw new Error('title requerido');
  }

  assertSafeBranch(headBranch, 'headBranch');
  assertSafeBranch(baseBranch, 'baseBranch');

  const activeBranch = (
    await runGit(
      ['branch', '--show-current'],
      workspacePath
    )
  ).stdout;

  if (activeBranch !== headBranch) {
    throw new Error(
      `Rama activa inesperada: ${activeBranch}`
    );
  }

  const status = (
    await runGit(
      ['status', '--short'],
      workspacePath
    )
  ).stdout;

  if (status) {
    throw new Error(
      'El workspace debe estar limpio antes de crear el PR'
    );
  }

  const localHead = (
    await runGit(
      ['rev-parse', 'HEAD'],
      workspacePath
    )
  ).stdout;

  const remoteHeadOutput = (
    await runGit(
      [
        'ls-remote',
        '--heads',
        'origin',
        headBranch
      ],
      workspacePath
    )
  ).stdout;

  const remoteHead =
    remoteHeadOutput.split(/\s+/)[0];

  if (!remoteHead) {
    throw new Error(
      'La rama temporal no existe en GitHub'
    );
  }

  if (remoteHead !== localHead) {
    throw new Error(
      'La rama temporal remota no coincide con el HEAD local'
    );
  }

  const comparison = (
    await runGit(
      [
        'rev-list',
        '--count',
        `origin/${baseBranch}..HEAD`
      ],
      workspacePath
    )
  ).stdout;

  if (Number(comparison) < 1) {
    throw new Error(
      'La rama temporal no contiene commits nuevos'
    );
  }

  const existing =
    await findExistingPullRequest({
      repository,
      headBranch,
      baseBranch,
      cwd: workspacePath
    });

  if (existing) {
    return {
      healthy: true,
      created: false,
      existing: true,
      repository,
      number: existing.number,
      url: existing.url,
      title: existing.title,
      headBranch: existing.headRefName,
      baseBranch: existing.baseRefName,
      headSha: localHead,
      finishedAt: new Date().toISOString()
    };
  }

  const result = await runGh(
    [
      'pr',
      'create',
      '--repo',
      repository,
      '--head',
      headBranch,
      '--base',
      baseBranch,
      '--title',
      title,
      '--body',
      body
    ],
    workspacePath
  );

  const url = result.stdout.trim();

  if (!url.includes('/pull/')) {
    throw new Error(
      `GitHub no devolvió una URL de PR válida: ${url}`
    );
  }

  const numberMatch =
    url.match(/\/pull\/(\d+)$/);

  if (!numberMatch) {
    throw new Error(
      'No fue posible determinar el número del PR'
    );
  }

  const number = Number(numberMatch[1]);

  const verification = await runGh(
    [
      'pr',
      'view',
      String(number),
      '--repo',
      repository,
      '--json',
      'number,url,state,title,headRefName,baseRefName,isDraft'
    ],
    workspacePath
  );

  const pr = JSON.parse(verification.stdout);

  if (pr.state !== 'OPEN') {
    throw new Error(
      `Estado inesperado del PR: ${pr.state}`
    );
  }

  if (pr.headRefName !== headBranch) {
    throw new Error(
      'La rama origen del PR no coincide'
    );
  }

  if (pr.baseRefName !== baseBranch) {
    throw new Error(
      'La rama destino del PR no coincide'
    );
  }

  return {
    healthy: true,
    created: true,
    existing: false,
    repository,
    number: pr.number,
    url: pr.url,
    title: pr.title,
    state: pr.state,
    draft: pr.isDraft,
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    headSha: localHead,
    finishedAt: new Date().toISOString()
  };
}

module.exports = {
  createPullRequest
};
