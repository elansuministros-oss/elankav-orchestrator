'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createJobSupabaseAdapter,
  getConfig,
  jobToRow,
  rowToJob
} = require('../adapters/jobSupabaseAdapter');

const ENV = Object.freeze({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-secret'
});

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    }
  };
}

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

test('PROG-001C exige configuración de Supabase', () => {
  assert.throws(
    () => getConfig({}),
    error => error.code === 'JOB_SUPABASE_NOT_CONFIGURED'
  );
});

test('PROG-001C exige HTTPS antes de usar service_role', () => {
  assert.throws(
    () => getConfig({
      SUPABASE_URL: 'http://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret'
    }),
    error => error.code === 'JOB_SUPABASE_URL_INVALID'
  );
});

test('PROG-001C convierte Job a fila y lo recupera sin perder campos', () => {
  const job = createJobFixture();
  assert.deepEqual(rowToJob(jobToRow(job)), job);
});

test('PROG-001C guarda un Job con service_role y upsert por id', async () => {
  const calls = [];
  const job = createJobFixture();
  const adapter = createJobSupabaseAdapter({
    env: ENV,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response([jobToRow(job)]);
    }
  });

  const saved = await adapter.saveJob(job);

  assert.deepEqual(saved, job);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /orchestrator_jobs\?on_conflict=id$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.apikey, 'service-secret');
  assert.match(calls[0].options.headers.Prefer, /merge-duplicates/);
});

test('PROG-001C recupera un Job por ID después de otro proceso', async () => {
  const job = createJobFixture();
  const adapter = createJobSupabaseAdapter({
    env: ENV,
    fetchImpl: async url => {
      assert.match(url, /id=eq\.JOB-1784000546608-ef3181ab/);
      return response([jobToRow(job)]);
    }
  });

  assert.deepEqual(await adapter.getJob(job.id), job);
});

test('PROG-001C no expone el contenido de errores de Supabase', async () => {
  const adapter = createJobSupabaseAdapter({
    env: ENV,
    fetchImpl: async () => response({ secret: 'no-exponer' }, 500)
  });

  await assert.rejects(
    () => adapter.listJobs(),
    error => (
      error.code === 'JOB_SUPABASE_REQUEST_FAILED' &&
      !error.message.includes('no-exponer')
    )
  );
});

test('PROG-001C normaliza fallos de red para la API', async () => {
  const adapter = createJobSupabaseAdapter({
    env: ENV,
    fetchImpl: async () => {
      throw new Error('socket detail');
    }
  });

  await assert.rejects(
    () => adapter.listJobs(),
    error => error.code === 'JOB_SUPABASE_REQUEST_FAILED'
  );
});
