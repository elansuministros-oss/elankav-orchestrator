const jobs = new Map();

function addJob(job) {
  jobs.set(job.id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function updateJob(id, changes) {
  const currentJob = getJob(id);

  if (!currentJob) {
    throw new Error(`Job no encontrado: ${id}`);
  }

  const updatedJob = {
    ...currentJob,
    ...changes,
    updatedAt: new Date().toISOString()
  };

  jobs.set(id, updatedJob);

  return updatedJob;
}

function listJobs() {
  return Array.from(jobs.values());
}

module.exports = {
  addJob,
  getJob,
  updateJob,
  listJobs
};
