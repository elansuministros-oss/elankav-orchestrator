'use strict';

const { Pool } = require('pg');

const TABLE_NAME = 'orchestrator_jobs';
const ACTIVE_STATUSES = Object.freeze(['pending', 'running']);

function normalize(value) {
  return String(value || '').trim();
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function getConfig(env = process.env) {
  const connectionString = normalize(env.DATABASE_URL);

  if (!connectionString) {
    const error = new Error('JOB_DATABASE_NOT_CONFIGURED');
    error.code = 'JOB_DATABASE_NOT_CONFIGURED';
    throw error;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(connectionString);
  } catch {
    const error = new Error('JOB_DATABASE_URL_INVALID');
    error.code = 'JOB_DATABASE_URL_INVALID';
    throw error;
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    const error = new Error('JOB_DATABASE_URL_INVALID');
    error.code = 'JOB_DATABASE_URL_INVALID';
    throw error;
  }

  if (parsedUrl.searchParams.get('sslmode') !== 'require') {
    const error = new Error('JOB_DATABASE_SSL_REQUIRED');
    error.code = 'JOB_DATABASE_SSL_REQUIRED';
    throw error;
  }

  return { connectionString };
}

function rowToJob(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    type: row.type,
    platform: row.platform,
    task: row.task,
    branch: row.branch || null,
    status: row.status,
    steps: Array.isArray(row.steps) ? row.steps : [],
    result: row.result || null,
    error: row.error || null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    startedAt: toIsoString(row.started_at),
    finishedAt: toIsoString(row.finished_at)
  };
}

function jobToValues(job) {
  return [
    job.id,
    job.type,
    job.platform,
    job.task,
    job.branch || null,
    job.status,
    JSON.stringify(Array.isArray(job.steps) ? job.steps : []),
    job.result === null || job.result === undefined
      ? null
      : JSON.stringify(job.result),
    job.error || null,
    job.createdAt,
    job.updatedAt || null,
    job.startedAt || null,
    job.finishedAt || null
  ];
}

function createPool(env = process.env) {
  const { connectionString } = getConfig(env);

  return new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    application_name: 'elankav-orchestrator-jobs'
  });
}

function createJobPostgresAdapter({
  env = process.env,
  pool
} = {}) {
  const database = pool || createPool(env);

  if (!database || typeof database.query !== 'function') {
    throw new Error('JOB_DATABASE_POOL_REQUIRED');
  }

  async function query(text, values = []) {
    try {
      return await database.query(text, values);
    } catch (cause) {
      const error = new Error('JOB_DATABASE_REQUEST_FAILED');
      error.code = 'JOB_DATABASE_REQUEST_FAILED';
      error.cause = cause;
      throw error;
    }
  }

  async function saveJob(job) {
    const result = await query(
      `insert into public.${TABLE_NAME} (
        id, type, platform, task, branch, status, steps,
        result, error, created_at, updated_at, started_at, finished_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7::jsonb,
        $8::jsonb, $9, $10, $11, $12, $13
      )
      on conflict (id) do update set
        type = excluded.type,
        platform = excluded.platform,
        task = excluded.task,
        branch = excluded.branch,
        status = excluded.status,
        steps = excluded.steps,
        result = excluded.result,
        error = excluded.error,
        updated_at = excluded.updated_at,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at
      returning *`,
      jobToValues(job)
    );

    return rowToJob(result.rows?.[0] || null);
  }

  async function getJob(id) {
    const result = await query(
      `select * from public.${TABLE_NAME} where id = $1 limit 1`,
      [id]
    );

    return rowToJob(result.rows?.[0] || null);
  }

  async function listJobs() {
    const result = await query(
      `select * from public.${TABLE_NAME} order by created_at desc`
    );

    return Array.isArray(result.rows)
      ? result.rows.map(rowToJob)
      : [];
  }

  async function markInterruptedJobs({
    interruptedAt = new Date().toISOString()
  } = {}) {
    const result = await query(
      `update public.${TABLE_NAME}
       set status = 'failed',
           error = 'ORCHESTRATOR_RESTARTED',
           updated_at = $1,
           finished_at = $1
       where status in ('pending', 'running')
       returning *`,
      [interruptedAt]
    );

    return Array.isArray(result.rows)
      ? result.rows.map(rowToJob)
      : [];
  }

  return Object.freeze({
    getJob,
    listJobs,
    markInterruptedJobs,
    saveJob
  });
}

module.exports = {
  ACTIVE_STATUSES,
  TABLE_NAME,
  createJobPostgresAdapter,
  createPool,
  getConfig,
  jobToValues,
  rowToJob,
  toIsoString
};
