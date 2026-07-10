const {
  createJob,
  getJob,
  listJobs
} = require('./jobs/jobEngine');
const { executeJob } = require('./jobs/jobExecutor');

function normalizeRequiredString(value, fieldName) {
  const normalized =
    typeof value === 'string' ? value.trim() : '';

  if (!normalized) {
    throw new Error(`${fieldName} es obligatorio`);
  }

  return normalized;
}

function createJobRequest({ platform, task, type }) {
  const normalizedPlatform =
    normalizeRequiredString(platform, 'platform');

  const normalizedTask =
    normalizeRequiredString(task, 'task');

  const normalizedType =
    typeof type === 'string' && type.trim()
      ? type.trim()
      : undefined;

  const job = createJob({
    platform: normalizedPlatform,
    task: normalizedTask,
    ...(normalizedType ? { type: normalizedType } : {})
  });

  executeJob(job.id).catch(error => {
    console.error(
      `[JOB_EXECUTION_ERROR] ${job.id}: ${error.message}`
    );
  });

  return {
    success: true,
    accepted: true,
    jobId: job.id,
    status: job.status,
    platform: job.platform,
    type: job.type,
    branch: job.branch,
    createdAt: job.createdAt
  };
}

module.exports = {
  createJobRequest,
  getJob,
  listJobs
};
