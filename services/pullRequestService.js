const {
  createPullRequest
} = require('../adapters/pullRequestAdapter');

function buildPullRequestTitle(job) {
  const task = String(job.task || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return `${job.id} — ${task || 'Cambio automatizado'}`;
}

function buildPullRequestBody({
  job,
  workspace,
  publish,
  qa
}) {
  const checks = Array.isArray(qa?.checks)
    ? qa.checks
        .map(check => {
          return `- ✅ \`${check.command}\``;
        })
        .join('\n')
    : '- ✅ QA aprobado';

  return [
    '## ELANKAV Orchestrator',
    '',
    `**Job:** \`${job.id}\``,
    `**Plataforma:** \`${job.platform}\``,
    `**Rama origen:** \`${job.branch}\``,
    `**Rama destino:** \`${workspace.baseBranch}\``,
    `**Commit:** \`${publish.commitSha}\``,
    '',
    '## Tarea',
    '',
    String(job.task || '').trim(),
    '',
    '## Validaciones',
    '',
    checks,
    '',
    '## Control',
    '',
    '- Este Pull Request fue generado automáticamente.',
    '- No se realizó merge automático.',
    '- Requiere aprobación explícita.',
    ''
  ].join('\n');
}

async function openJobPullRequest({
  job,
  workspace,
  publish,
  qa
}) {
  if (!job?.id) {
    throw new Error('job requerido');
  }

  if (!workspace?.repository) {
    throw new Error('repository requerido');
  }

  if (!workspace?.baseBranch) {
    throw new Error('baseBranch requerida');
  }

  if (!workspace?.workspacePath) {
    throw new Error('workspacePath requerido');
  }

  if (!publish?.healthy || !publish?.pushed) {
    throw new Error(
      'Pull Request bloqueado: cambios no publicados'
    );
  }

  if (!qa?.healthy) {
    throw new Error(
      'Pull Request bloqueado: QA no aprobado'
    );
  }

  return createPullRequest({
    repository: workspace.repository,
    workspacePath: workspace.workspacePath,
    headBranch: job.branch,
    baseBranch: workspace.baseBranch,
    title: buildPullRequestTitle(job),
    body: buildPullRequestBody({
      job,
      workspace,
      publish,
      qa
    })
  });
}

module.exports = {
  openJobPullRequest
};
