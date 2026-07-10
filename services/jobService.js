const {
  createJob,
  getJob,
  listJobs
} = require('./jobs/jobEngine');

function createJobRequest({ platform, task, type }) {
  const normalizedPlatform =
    typeof platform === 'string' ? platform.trim() : '';

  const normalizedTask =
    typeof task === 'string' ? task.trim() : '';

  const normalizedType =
    typeof type === 'string' && type.trim()
      ? type.trim()
      : undefined;

  if (!normalizedPlatform) {
    throw new Error('platform es obligatorio');
  }

  if (!normalizedTask) {
    throw new Error('task es obligatorio');
  }

  const job = createJob({
    platform: normalizedPlatform,
    task: normalizedTask,
    ...(normalizedType ? { type: normalizedType } : {})
  });

  return {
    success: true,
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
