const jobs = new Map();

function addJob(job) {
  jobs.set(job.id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function listJobs() {
  return Array.from(jobs.values());
}

module.exports = {
  addJob,
  getJob,
  listJobs,
};
