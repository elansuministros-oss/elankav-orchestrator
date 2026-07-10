const repositories = require('../config/github.json');

const {
  createRepositoryWorkspace
} = require('../adapters/repositoryWorkspaceAdapter');

function normalizePlatform(platform) {
  return String(platform || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

function resolveRepository(platform) {
  const platformId = normalizePlatform(platform);

  const repository = repositories.find(item => {
    return normalizePlatform(item.id) === platformId;
  });

  if (!repository) {
    throw new Error(
      `Plataforma no configurada: ${platform}`
    );
  }

  return repository;
}

async function prepareJobWorkspace(job) {
  if (!job?.id) {
    throw new Error('job requerido');
  }

  const repository = resolveRepository(job.platform);

  return createRepositoryWorkspace({
    jobId: job.id,
    owner: repository.owner,
    repo: repository.repo,
    baseBranch: repository.branch,
    jobBranch: job.branch
  });
}

module.exports = {
  resolveRepository,
  prepareJobWorkspace
};
