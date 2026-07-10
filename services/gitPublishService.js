const {
  publishWorkspaceChanges
} = require('../adapters/gitPublishAdapter');

function buildCommitMessage(job) {
  const task = String(job.task || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);

  return `${job.id} ${task || 'cambio automatizado'}`;
}

async function publishJobChanges({
  job,
  workspace,
  changes,
  qa
}) {
  if (!job?.id) {
    throw new Error('job requerido');
  }

  if (!workspace?.workspacePath) {
    throw new Error('workspace requerido');
  }

  if (!changes?.changed) {
    throw new Error(
      'No existen cambios para publicar'
    );
  }

  if (!qa?.healthy) {
    throw new Error(
      'Publicación bloqueada: QA no aprobado'
    );
  }

  return publishWorkspaceChanges({
    workspacePath: workspace.workspacePath,
    expectedBranch: job.branch,
    commitMessage: buildCommitMessage(job)
  });
}

module.exports = {
  publishJobChanges
};
