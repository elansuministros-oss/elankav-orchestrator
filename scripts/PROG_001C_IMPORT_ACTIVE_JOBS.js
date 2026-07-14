'use strict';

require('dotenv').config({
  path: '/etc/elankav-orchestrator.env',
  quiet: true
});

const {
  createJobPostgresAdapter
} = require('../adapters/jobPostgresAdapter');

const DEFAULT_SOURCE_URL =
  'http://172.19.0.1:4100/api/jobs';

function validateJob(job) {
  if (
    !job ||
    typeof job !== 'object' ||
    !String(job.id || '').startsWith('JOB-') ||
    !job.type ||
    !job.platform ||
    !job.task ||
    !job.status ||
    !job.createdAt
  ) {
    const error = new Error('JOB_IMPORT_INVALID_SOURCE_DATA');
    error.code = 'JOB_IMPORT_INVALID_SOURCE_DATA';
    throw error;
  }

  return job;
}

async function fetchActiveJobs({
  sourceUrl = process.env.JOB_IMPORT_SOURCE_URL || DEFAULT_SOURCE_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('JOB_IMPORT_FETCH_REQUIRED');
  }

  const response = await fetchImpl(sourceUrl, {
    headers: { Accept: 'application/json' }
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success || !Array.isArray(payload.jobs)) {
    const error = new Error('JOB_IMPORT_SOURCE_UNAVAILABLE');
    error.code = 'JOB_IMPORT_SOURCE_UNAVAILABLE';
    throw error;
  }

  return payload.jobs.map(validateJob);
}

async function importActiveJobs({
  adapter = createJobPostgresAdapter(),
  fetchImpl = globalThis.fetch,
  sourceUrl
} = {}) {
  const jobs = await fetchActiveJobs({
    fetchImpl,
    ...(sourceUrl ? { sourceUrl } : {})
  });
  const imported = [];

  for (const job of jobs) {
    const saved = await adapter.saveJob(job);

    if (!saved?.id) {
      const error = new Error('JOB_IMPORT_WRITE_FAILED');
      error.code = 'JOB_IMPORT_WRITE_FAILED';
      throw error;
    }

    imported.push(saved.id);
  }

  return {
    imported: imported.length,
    jobIds: imported
  };
}

async function main() {
  const result = await importActiveJobs();
  console.log(`[JOB_IMPORT_COMPLETED] imported=${result.imported}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[JOB_IMPORT_FAILED] ${error.code || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_SOURCE_URL,
  fetchActiveJobs,
  importActiveJobs,
  validateJob
};
