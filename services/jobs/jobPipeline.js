const { githubHealth } = require('./jobGithub');
const { openaiHealth } = require('./jobOpenAI');
const { codexAnalyze } = require('./jobCodex');

const {
  prepareJobWorkspace
} = require('../repositoryWorkspaceService');

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

  const codexResult = await codexAnalyze(job.task);

  result.steps.push({
    step: 'codex',
    ...codexResult
  });

  if (!codexResult.healthy) {
    throw new Error(
      codexResult.error || 'Codex no completó el análisis'
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
