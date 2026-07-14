'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createJobPostgresAdapter,
  getConfig,
  jobToValues,
  rowToJob
} = require('../adapters/jobPostgresAdapter');

const ENV = Object.freeze({
  DATABASE_URL:
    'postgresql://user:password@example.neon.tech/postgres?sslmode=require'
});

function createJobFixture(overrides = {}) {
  return {
    id: 'JOB-1784000546608-ef3181ab',
    type: 'context_sync',
    platform: 'elanvisual',
    task: 'Cargar contexto',
    branch: null,
    status: 'completed',
    steps: ['documentation', 'git', 'context'],
    result: { healthy: true },
    error: null,
    createdAt: '2026-07-14T03:42:26.608Z',
    updatedAt: '2026-07-14T03:42:26.629Z',
    startedAt: '2026-07-14T03:42:26.610Z',
    finishedAt: '2026-07-14T03:42:26.629Z',
    ...overrides
  };
}

function jobToRow(job) {
  return {
    id: job.id,
    type: job.type,
    platform: job.platform,
    task: job.task,
    branch: job.branch,
    status: job.status,
    steps: job.steps,
    result: job.result,
    error: job.error,
    created_at: new Date(job.createdAt),
    updated_at: job.updatedAt ? new Date(job.updatedAt) : null,
    started_at: job.startedAt ? new Date(job.startedAt) : null,
    finished_at: job.finishedAt ? new Date(job.finishedAt) : null
  };
}

function createPool(handler) {
  return {
    calls: [],
    async query(text, values) {
      this.calls.push({ text, values });
      return handler(text, values);
    }
  };
}

test('PROG-001C exige DATABASE_URL para Neon', () => {
  assert.throws(
    () => getConfig({}),
    error => error.code === 'JOB_DATABASE_NOT_CONFIGURED'
  );
});

test('PROG-001C exige PostgreSQL cifrado', () => {
  assert.throws(
    () => getConfig({ DATABASE_URL: 'http://example.com' }),
    error => error.code === 'JOB_DATABASE_URL_INVALID'
  );

  assert.throws(
    () => getConfig({
      DATABASE_URL: 'postgresql://user:password@example.neon.tech/postgres'
    }),
    error => error.code === 'JOB_DATABASE_SSL_REQUIRED'
  );
});

test('PROG-001C convierte fechas PostgreSQL a contrato JSON', () => {
  const job = createJobFixture();
  assert.deepEqual(rowToJob(jobToRow(job)), job);
});

test('PROG-001C serializa campos JSONB antes de enviarlos a pg', () => {
  const values = jobToValues(createJobFixture());

  assert.equal(values[6], '["documentation","git","context"]');
  assert.equal(values[7], '{"healthy":true}');
});

test('PROG-001C guarda un Job con SQL parametrizado y upsert', async () => {
  const job = createJobFixture();
  const pool = createPool(async () => ({ rows: [jobToRow(job)] }));
  const adapter = createJobPostgresAdapter({ env: ENV, pool });

  const saved = await adapter.saveJob(job);

  assert.deepEqual(saved, job);
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].text, /on conflict \(id\) do update/i);
  assert.match(pool.calls[0].text, /returning \*/i);
  assert.equal(pool.calls[0].values[0], job.id);
  assert.equal(pool.calls[0].text.includes(job.id), false);
});

test('PROG-001C recupera un Job por ID después de otro proceso', async () => {
  const job = createJobFixture();
  const pool = createPool(async () => ({ rows: [jobToRow(job)] }));
  const adapter = createJobPostgresAdapter({ env: ENV, pool });

  assert.deepEqual(await adapter.getJob(job.id), job);
  assert.equal(pool.calls[0].values[0], job.id);
});

test('PROG-001C no expone detalles de errores de PostgreSQL', async () => {
  const pool = createPool(async () => {
    throw new Error('postgres://usuario:clave@servidor');
  });
  const adapter = createJobPostgresAdapter({ env: ENV, pool });

  await assert.rejects(
    () => adapter.listJobs(),
    error => (
      error.code === 'JOB_DATABASE_REQUEST_FAILED' &&
      !error.message.includes('usuario')
    )
  );
});

test('PROG-001C cierra Jobs activos con una actualización única', async () => {
  const job = createJobFixture({
    status: 'failed',
    error: 'ORCHESTRATOR_RESTARTED'
  });
  const pool = createPool(async () => ({ rows: [jobToRow(job)] }));
  const adapter = createJobPostgresAdapter({ env: ENV, pool });

  const recovered = await adapter.markInterruptedJobs({
    interruptedAt: job.finishedAt
  });

  assert.equal(recovered.length, 1);
  assert.match(pool.calls[0].text, /where status in \('pending', 'running'\)/i);
  assert.deepEqual(pool.calls[0].values, [job.finishedAt]);
});
