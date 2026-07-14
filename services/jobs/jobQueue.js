'use strict';

const {
  createJobPostgresAdapter
} = require('../../adapters/jobPostgresAdapter');

let jobStoreAdapter;
let persistenceState = {
  healthy: null,
  recoveredJobs: 0,
  checkedAt: null,
  error: null
};

function getJobStoreAdapter() {
  if (!jobStoreAdapter) {
    jobStoreAdapter = createJobPostgresAdapter();
  }

  return jobStoreAdapter;
}

async function addJob(job) {
  const savedJob = await getJobStoreAdapter().saveJob(job);

  if (!savedJob) {
    throw new Error('JOB_PERSISTENCE_WRITE_FAILED');
  }

  return savedJob;
}

async function getJob(id) {
  return getJobStoreAdapter().getJob(id);
}

async function updateJob(id, changes) {
  const currentJob = await getJob(id);

  if (!currentJob) {
    throw new Error(`Job no encontrado: ${id}`);
  }

  const updatedJob = {
    ...currentJob,
    ...changes,
    updatedAt: new Date().toISOString()
  };

  const savedJob = await getJobStoreAdapter().saveJob(updatedJob);

  if (!savedJob) {
    throw new Error('JOB_PERSISTENCE_WRITE_FAILED');
  }

  return savedJob;
}

async function listJobs() {
  return getJobStoreAdapter().listJobs();
}

async function initializeJobQueue() {
  const checkedAt = new Date().toISOString();

  try {
    const recovered = await getJobStoreAdapter().markInterruptedJobs({
      interruptedAt: checkedAt
    });

    persistenceState = {
      healthy: true,
      recoveredJobs: recovered.length,
      checkedAt,
      error: null
    };
  } catch (error) {
    persistenceState = {
      healthy: false,
      recoveredJobs: 0,
      checkedAt,
      error: error.code || error.message
    };

    throw error;
  }

  return { ...persistenceState };
}

function getJobPersistenceState() {
  return { ...persistenceState };
}

function setJobStoreAdapterForTests(adapter) {
  jobStoreAdapter = adapter || undefined;
  persistenceState = {
    healthy: null,
    recoveredJobs: 0,
    checkedAt: null,
    error: null
  };
}

module.exports = {
  addJob,
  getJob,
  getJobPersistenceState,
  initializeJobQueue,
  listJobs,
  setJobStoreAdapterForTests,
  updateJob
};
