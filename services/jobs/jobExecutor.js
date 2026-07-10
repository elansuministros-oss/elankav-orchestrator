const { JOB_STATUS } = require('./jobTypes');
const {
  getJob,
  updateJob
} = require('./jobQueue');
const { run } = require('./jobPipeline');

async function executeJob(jobId) {
  const job = getJob(jobId);

  if (!job) {
    throw new Error(`Job no encontrado: ${jobId}`);
  }

  updateJob(jobId, {
    status: JOB_STATUS.RUNNING,
    startedAt: new Date().toISOString(),
    error: null
  });

  try {
    const pipelineResult = await run(job);

    return updateJob(jobId, {
      status: JOB_STATUS.COMPLETED,
      result: pipelineResult,
      finishedAt: new Date().toISOString()
    });
  } catch (error) {
    updateJob(jobId, {
      status: JOB_STATUS.FAILED,
      error: error.message,
      finishedAt: new Date().toISOString()
    });

    throw error;
  }
}

module.exports = {
  executeJob
};
