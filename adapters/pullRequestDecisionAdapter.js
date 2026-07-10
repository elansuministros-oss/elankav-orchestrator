const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function runGh(args) {
  const result = await execFileAsync(
    'gh',
    args,
    {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function inspectPullRequest({
  repository,
  number
}) {
  if (!repository) {
    throw new Error('repository requerido');
  }

  if (
    !Number.isInteger(number) ||
    number < 1
  ) {
    throw new Error('Número de PR inválido');
  }

  const result = await runGh([
    'pr',
    'view',
    String(number),
    '--repo',
    repository,
    '--json',
    [
      'number',
      'url',
      'state',
      'title',
      'headRefName',
      'baseRefName',
      'headRefOid',
      'mergeable',
      'mergedAt',
      'isDraft',
      'statusCheckRollup'
    ].join(',')
  ]);

  return JSON.parse(result.stdout);
}

function validateChecks(statusCheckRollup) {
  const checks = Array.isArray(statusCheckRollup)
    ? statusCheckRollup
    : [];

  const blocked = checks.filter(check => {
    const conclusion = String(
      check.conclusion || check.state || ''
    ).toUpperCase();

    const status = String(
      check.status || ''
    ).toUpperCase();

    if (
      status &&
      status !== 'COMPLETED'
    ) {
      return true;
    }

    if (
      conclusion &&
      ![
        'SUCCESS',
        'NEUTRAL',
        'SKIPPED'
      ].includes(conclusion)
    ) {
      return true;
    }

    return false;
  });

  return {
    total: checks.length,
    healthy: blocked.length === 0,
    blocked
  };
}

async function mergePullRequest({
  repository,
  number
}) {
  await runGh([
    'pr',
    'merge',
    String(number),
    '--repo',
    repository,
    '--merge'
  ]);

  return inspectPullRequest({
    repository,
    number
  });
}

async function rejectPullRequest({
  repository,
  number,
  reason
}) {
  const args = [
    'pr',
    'close',
    String(number),
    '--repo',
    repository
  ];

  if (reason) {
    args.push(
      '--comment',
      `Rechazado por ELANKAV Orchestrator: ${reason}`
    );
  }

  await runGh(args);

  return inspectPullRequest({
    repository,
    number
  });
}

module.exports = {
  inspectPullRequest,
  validateChecks,
  mergePullRequest,
  rejectPullRequest
};
