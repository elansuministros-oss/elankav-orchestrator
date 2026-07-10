const { githubHealth } = require('./jobGithub');
const { openaiHealth } = require('./jobOpenAI');
const { codexHealth } = require('./jobCodex');

async function run(job) {

  const result = {
    jobId: job.id,
    startedAt: new Date().toISOString(),
    steps: []
  };

  result.steps.push({
    step: 'github',
    ...(await githubHealth())
  });

  result.steps.push({
    step: 'openai',
    ...(await openaiHealth())
  });

  result.steps.push({
    step: 'codex',
    ...(await codexHealth())
  });

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
  run,
};
