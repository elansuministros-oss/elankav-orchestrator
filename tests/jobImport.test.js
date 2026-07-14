'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  importActiveJobs,
  validateJob
} = require('../scripts/PROG_001C_IMPORT_ACTIVE_JOBS');

function job(id, status = 'completed') {
  return {
    id,
    type: 'context_sync',
    platform: 'elanvisual',
    task: 'Cargar contexto',
    branch: null,
    status,
    steps: ['documentation'],
    result: { healthy: true },
    error: null,
    createdAt: '2026-07-14T03:42:26.608Z',
    updatedAt: null,
    startedAt: null,
    finishedAt: null
  };
}

function response(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

test('PROG-001C importa los Jobs del proceso anterior antes del reinicio', async () => {
  const stored = new Map();
  const jobs = [
    job('JOB-1784000546608-ef3181ab'),
    job('JOB-1784000546609-abcd1234', 'running')
  ];
  const adapter = {
    async saveJob(value) {
      stored.set(value.id, value);
      return value;
    }
  };

  const result = await importActiveJobs({
    adapter,
    fetchImpl: async () => response({
      success: true,
      count: jobs.length,
      jobs
    })
  });

  assert.equal(result.imported, 2);
  assert.deepEqual(result.jobIds, jobs.map(value => value.id));
  assert.equal(stored.size, 2);
});

test('PROG-001C rechaza registros incompletos durante la importación', () => {
  assert.throws(
    () => validateJob({ id: 'JOB-incompleto' }),
    error => error.code === 'JOB_IMPORT_INVALID_SOURCE_DATA'
  );
});
