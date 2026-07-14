'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');

const {
  getJob,
  getJobPersistenceState,
  initializeJobQueue,
  setJobStoreAdapterForTests,
  updateJob
} = require('../services/jobs/jobQueue');
const { createJob } = require('../services/jobs/jobEngine');
const {
  OWNER_COMMANDS,
  executeOwnerCommand
} = require('../services/ownerCommandService');

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function createDurableAdapter() {
  const rows = new Map();

  return {
    rows,
    async saveJob(job) {
      rows.set(job.id, clone(job));
      return clone(job);
    },
    async getJob(id) {
      return clone(rows.get(id) || null);
    },
    async listJobs() {
      return Array.from(rows.values()).map(clone);
    },
    async markInterruptedJobs({ interruptedAt }) {
      const recovered = [];

      for (const [id, job] of rows.entries()) {
        if (!['pending', 'running'].includes(job.status)) {
          continue;
        }

        const interrupted = {
          ...job,
          status: 'failed',
          error: 'ORCHESTRATOR_RESTARTED',
          updatedAt: interruptedAt,
          finishedAt: interruptedAt
        };

        rows.set(id, interrupted);
        recovered.push(clone(interrupted));
      }

      return recovered;
    }
  };
}

const durableAdapter = createDurableAdapter();
setJobStoreAdapterForTests(durableAdapter);

after(() => {
  setJobStoreAdapterForTests(null);
});

test('PROG-001C crea el Job únicamente después de guardarlo', async () => {
  const job = await createJob({
    platform: 'elanvisual',
    task: 'Auditar persistencia'
  });

  assert.equal(job.status, 'pending');
  assert.deepEqual(await getJob(job.id), job);
});

test('PROG-001C conserva el Job al reconstruir la cola', async () => {
  const [job] = Array.from(durableAdapter.rows.values());

  setJobStoreAdapterForTests(durableAdapter);

  assert.deepEqual(await getJob(job.id), job);
});

test('PROG-001C cierra Jobs activos al iniciar después de reinicio', async () => {
  const [job] = Array.from(durableAdapter.rows.values());
  await updateJob(job.id, {
    status: 'running',
    startedAt: '2026-07-14T04:00:00.000Z'
  });

  const recovery = await initializeJobQueue();
  const recoveredJob = await getJob(job.id);

  assert.equal(recovery.healthy, true);
  assert.equal(recovery.recoveredJobs, 1);
  assert.equal(recoveredJob.status, 'failed');
  assert.equal(recoveredJob.error, 'ORCHESTRATOR_RESTARTED');
  assert.equal(getJobPersistenceState().healthy, true);
});

test('MOBILE-01B consulta por WhatsApp un Job recuperado', async () => {
  const [job] = Array.from(durableAdapter.rows.values());
  const result = await executeOwnerCommand({
    command: {
      type: OWNER_COMMANDS.JOB_STATUS,
      jobId: job.id
    }
  });

  assert.equal(result.job.id, job.id);
  assert.match(result.outputText, new RegExp(job.id));
  assert.match(result.outputText, /ORCHESTRATOR_RESTARTED/);
});
