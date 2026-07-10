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

function serializeJob(job) {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    type: job.type,
    platform: job.platform,
    task: job.task,
    branch: job.branch,
    status: job.status,
    steps: job.steps,
    result: job.result || null,
    error: job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null
  };
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

function getJobRequest(jobId) {
  const normalizedJobId =
    normalizeRequiredString(jobId, 'jobId');

  const job = getJob(normalizedJobId);

  if (!job) {
    return null;
  }

  return serializeJob(job);
}

function listJobsRequest() {
  return listJobs()
    .map(serializeJob)
    .sort((left, right) => {
      return String(right.createdAt).localeCompare(
        String(left.createdAt)
      );
    });
}

module.exports = {
  createJobRequest,
  getJobRequest,
  listJobsRequest
};
