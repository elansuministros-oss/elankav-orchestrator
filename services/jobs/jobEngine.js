const crypto = require('node:crypto');
const {
  JOB_TYPES,
  JOB_STATUS,
  getJobSteps
} = require('./jobTypes');
const { addJob, getJob, listJobs } = require('./jobQueue');

async function createJob({ platform, task, type = JOB_TYPES.CODE }) {
  if (!platform || !task) {
    throw new Error('platform y task son obligatorios');
  }

  const allowedTypes = Object.values(JOB_TYPES);

  if (!allowedTypes.includes(type)) {
    throw new Error(`Tipo de job no soportado: ${type}`);
  }

  const id = `JOB-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const job = {
    id,
    type,
    platform,
    task,
    branch:
      type === JOB_TYPES.CODE
        ? `job/${id.toLowerCase()}`
        : null,
    status: JOB_STATUS.PENDING,
    steps: getJobSteps(type),
    createdAt: new Date().toISOString(),
  };

  return addJob(job);
}

const { githubHealth } = require('./jobGithub');
const { openaiHealth } = require('./jobOpenAI');

module.exports = {
  openaiHealth,
  githubHealth,
  createJob,
  getJob,
  listJobs,
};
