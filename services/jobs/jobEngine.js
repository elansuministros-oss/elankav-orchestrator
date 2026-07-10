const crypto = require('node:crypto');
const { JOB_TYPES, JOB_STATUS, JOB_STEPS } = require('./jobTypes');
const { addJob, getJob, listJobs } = require('./jobQueue');

function createJob({ platform, task, type = JOB_TYPES.CODE }) {
  if (!platform || !task) {
    throw new Error('platform y task son obligatorios');
  }

  const id = `JOB-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const job = {
    id,
    type,
    platform,
    task,
    branch: `job/${id.toLowerCase()}`,
    status: JOB_STATUS.PENDING,
    steps: [...JOB_STEPS],
    createdAt: new Date().toISOString(),
  };

  return addJob(job);
}

module.exports = {
  createJob,
  getJob,
  listJobs,
};
