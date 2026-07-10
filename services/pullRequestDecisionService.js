const repositories = require('../config/github.json');

const {
  inspectPullRequest,
  validateChecks,
  mergePullRequest,
  rejectPullRequest
} = require('../adapters/pullRequestDecisionAdapter');

function normalizePlatform(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

function resolveRepository(platform) {
  const normalized =
    normalizePlatform(platform);

  const repository = repositories.find(item => {
    return normalizePlatform(item.id) === normalized;
  });

  if (!repository) {
    throw new Error(
      `Plataforma no configurada: ${platform}`
    );
  }

  return {
    id: repository.id,
    fullName:
      `${repository.owner}/${repository.repo}`,
    baseBranch: repository.branch
  };
}

function validatePullRequest({
  pullRequest,
  repository
}) {
  if (pullRequest.state !== 'OPEN') {
    throw new Error(
      `El PR no está abierto: ${pullRequest.state}`
    );
  }

  if (pullRequest.mergedAt) {
    throw new Error('El PR ya fue mergeado');
  }

  if (pullRequest.isDraft) {
    throw new Error(
      'No se puede aprobar un PR en borrador'
    );
  }

  if (
    !pullRequest.headRefName.startsWith('job/')
  ) {
    throw new Error(
      'La rama origen no es temporal job/*'
    );
  }

  if (
    pullRequest.baseRefName !==
    repository.baseBranch
  ) {
    throw new Error(
      `Rama destino no autorizada: ${pullRequest.baseRefName}`
    );
  }

  if (
    pullRequest.baseRefName === 'main' ||
    pullRequest.baseRefName === 'master'
  ) {
    throw new Error(
      'Merge directo a main/master bloqueado'
    );
  }

  return true;
}

async function inspectJobPullRequest({
  platform,
  number
}) {
  const repository =
    resolveRepository(platform);

  const pullRequest =
    await inspectPullRequest({
      repository: repository.fullName,
      number
    });

  validatePullRequest({
    pullRequest,
    repository
  });

  const checks = validateChecks(
    pullRequest.statusCheckRollup
  );

  return {
    healthy: true,
    repository,
    pullRequest,
    checks
  };
}

async function decideJobPullRequest({
  platform,
  number,
  action,
  confirmation,
  reason
}) {
  const normalizedAction =
    String(action || '').trim().toLowerCase();

  if (
    !['approve', 'reject'].includes(
      normalizedAction
    )
  ) {
    throw new Error(
      'action debe ser approve o reject'
    );
  }

  const expectedConfirmation =
    normalizedAction === 'approve'
      ? `APPROVE PR ${number}`
      : `REJECT PR ${number}`;

  if (confirmation !== expectedConfirmation) {
    throw new Error(
      `Confirmación inválida. Se requiere: ${expectedConfirmation}`
    );
  }

  const inspected =
    await inspectJobPullRequest({
      platform,
      number
    });

  if (
    normalizedAction === 'approve' &&
    !inspected.checks.healthy
  ) {
    throw new Error(
      'Merge bloqueado: existen checks pendientes o fallidos'
    );
  }

  if (normalizedAction === 'approve') {
    const merged = await mergePullRequest({
      repository:
        inspected.repository.fullName,
      number
    });

    if (!merged.mergedAt) {
      throw new Error(
        'GitHub no confirmó el merge'
      );
    }

    return {
      success: true,
      action: 'approve',
      merged: true,
      repository:
        inspected.repository.fullName,
      number,
      url: merged.url,
      mergedAt: merged.mergedAt,
      baseBranch: merged.baseRefName,
      headBranch: merged.headRefName
    };
  }

  const rejected =
    await rejectPullRequest({
      repository:
        inspected.repository.fullName,
      number,
      reason
    });

  if (rejected.state !== 'CLOSED') {
    throw new Error(
      'GitHub no confirmó el cierre del PR'
    );
  }

  return {
    success: true,
    action: 'reject',
    rejected: true,
    repository:
      inspected.repository.fullName,
    number,
    url: rejected.url,
    state: rejected.state,
    baseBranch: rejected.baseRefName,
    headBranch: rejected.headRefName
  };
}

module.exports = {
  inspectJobPullRequest,
  decideJobPullRequest
};
