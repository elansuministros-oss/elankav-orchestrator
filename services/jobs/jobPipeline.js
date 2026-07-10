const { githubHealth } = require('./jobGithub');
const { openaiHealth } = require('./jobOpenAI');

const {
  prepareJobWorkspace
} = require('../repositoryWorkspaceService');

const {
  applyJobChanges
} = require('../repositoryChangeService');

async function run(job) {
  if (!job) {
    throw new Error('job requerido');
  }

  const result = {
    jobId: job.id,
    startedAt: new Date().toISOString(),
    steps: []
  };

  const githubResult = await githubHealth();

  result.steps.push({
    step: 'github',
    ...githubResult
  });

  if (!githubResult.healthy) {
    throw new Error(
      githubResult.error || 'GitHub no está saludable'
    );
  }

  const workspaceResult =
    await prepareJobWorkspace(job);

  result.steps.push({
    step: 'workspace',
    ...workspaceResult
  });

  if (!workspaceResult.healthy) {
    throw new Error(
      'No fue posible preparar el workspace'
    );
  }

  const openaiResult = await openaiHealth();

  result.steps.push({
    step: 'openai',
    ...openaiResult
  });

  if (!openaiResult.healthy) {
    throw new Error(
      openaiResult.error || 'OpenAI no está saludable'
    );
  }

  const changesResult = await applyJobChanges({
    job,
    workspace: workspaceResult
  });

  result.steps.push({
    step: 'codex',
    healthy: changesResult.codex != null,
    model: changesResult.codex?.model,
    sandbox: changesResult.codex?.sandbox
  });

  result.steps.push({
    step: 'changes',
    ...changesResult
  });

  if (!changesResult.healthy) {
    throw new Error(
      'Codex no completó los cambios'
    );
  }

  result.steps.push({
    step: 'qa',
    status: 'pending'
  });

  result.steps.push({
    step: 'pr',
    status: 'pending'
  });

  result.finishedAt = new Date().toISOString();

  return result;
}

module.exports = {
  run
};
