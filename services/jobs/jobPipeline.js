const { githubHealth } = require('./jobGithub');
const { openaiHealth } = require('./jobOpenAI');

const {
  prepareJobWorkspace
} = require('../repositoryWorkspaceService');

const {
  applyJobChanges
} = require('../repositoryChangeService');

const {
  runJobQa
} = require('../qaService');

const {
  publishJobChanges
} = require('../gitPublishService');

const {
  openJobPullRequest
} = require('../pullRequestService');

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
      githubResult.error ||
      'GitHub no está saludable'
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
      'Workspace no saludable'
    );
  }

  const openaiResult = await openaiHealth();

  result.steps.push({
    step: 'openai',
    ...openaiResult
  });

  if (!openaiResult.healthy) {
    throw new Error(
      openaiResult.error ||
      'OpenAI no está saludable'
    );
  }

  const changesResult = await applyJobChanges({
    job,
    workspace: workspaceResult
  });

  result.steps.push({
    step: 'codex',
    healthy: Boolean(changesResult.codex),
    model: changesResult.codex?.model,
    sandbox: changesResult.codex?.sandbox
  });

  result.steps.push({
    step: 'changes',
    ...changesResult
  });

  if (!changesResult.changed) {
    throw new Error(
      'Codex no produjo cambios'
    );
  }

  const qaResult = await runJobQa({
    job,
    workspace: workspaceResult,
    changes: changesResult
  });

  result.steps.push({
    step: 'qa',
    ...qaResult
  });

  if (!qaResult.healthy) {
    throw new Error('QA no aprobado');
  }

  const publishResult =
    await publishJobChanges({
      job,
      workspace: workspaceResult,
      changes: changesResult,
      qa: qaResult
    });

  result.steps.push({
    step: 'publish',
    ...publishResult
  });

  if (!publishResult.healthy) {
    throw new Error(
      'No fue posible publicar la rama temporal'
    );
  }

  const pullRequestResult =
    await openJobPullRequest({
      job,
      workspace: workspaceResult,
      publish: publishResult,
      qa: qaResult
    });

  result.steps.push({
    step: 'pr',
    ...pullRequestResult
  });

  if (!pullRequestResult.healthy) {
    throw new Error(
      'No fue posible crear el Pull Request'
    );
  }

  result.finishedAt = new Date().toISOString();

  return result;
}

module.exports = {
  run
};
