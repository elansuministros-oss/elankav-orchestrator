'use strict';

const TABLE_NAME = 'orchestrator_jobs';
const ACTIVE_STATUSES = Object.freeze(['pending', 'running']);

function normalize(value) {
  return String(value || '').trim();
}

function getConfig(env = process.env) {
  const url = normalize(env.SUPABASE_URL).replace(/\/+$/, '');
  const key = normalize(
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY
  );

  if (!url || !key) {
    const error = new Error('JOB_SUPABASE_NOT_CONFIGURED');
    error.code = 'JOB_SUPABASE_NOT_CONFIGURED';
    throw error;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    const error = new Error('JOB_SUPABASE_URL_INVALID');
    error.code = 'JOB_SUPABASE_URL_INVALID';
    throw error;
  }

  if (parsedUrl.protocol !== 'https:') {
    const error = new Error('JOB_SUPABASE_URL_INVALID');
    error.code = 'JOB_SUPABASE_URL_INVALID';
    throw error;
  }

  return { url, key };
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
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null
  };
}

function jobToRow(job) {
  return {
    id: job.id,
    type: job.type,
    platform: job.platform,
    task: job.task,
    branch: job.branch || null,
    status: job.status,
    steps: Array.isArray(job.steps) ? job.steps : [],
    result: job.result || null,
    error: job.error || null,
    created_at: job.createdAt,
    updated_at: job.updatedAt || null,
    started_at: job.startedAt || null,
    finished_at: job.finishedAt || null
  };
}

function createJobSupabaseAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('JOB_SUPABASE_FETCH_REQUIRED');
  }

  async function request({
    method = 'GET',
    query = '',
    body,
    prefer = 'return=representation'
  } = {}) {
    const { url, key } = getConfig(env);
    let response;

    try {
      response = await fetchImpl(
        `${url}/rest/v1/${TABLE_NAME}${query ? `?${query}` : ''}`,
        {
          method,
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: prefer
          },
          body: body === undefined
            ? undefined
            : JSON.stringify(body)
        }
      );
    } catch (cause) {
      const error = new Error('JOB_SUPABASE_REQUEST_FAILED:NETWORK');
      error.code = 'JOB_SUPABASE_REQUEST_FAILED';
      error.cause = cause;
      throw error;
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(`JOB_SUPABASE_REQUEST_FAILED:${response.status}`);
      error.code = 'JOB_SUPABASE_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }

    return data;
  }

  async function saveJob(job) {
    const rows = await request({
      method: 'POST',
      query: 'on_conflict=id',
      body: jobToRow(job),
      prefer: 'return=representation,resolution=merge-duplicates'
    });

    return rowToJob(rows?.[0] || null);
  }

  async function getJob(id) {
    const rows = await request({
      query: `select=*&id=eq.${encodeURIComponent(id)}&limit=1`
    });

    return rowToJob(rows?.[0] || null);
  }

  async function listJobs() {
    const rows = await request({
      query: 'select=*&order=created_at.desc'
    });

    return Array.isArray(rows)
      ? rows.map(rowToJob)
      : [];
  }

  async function markInterruptedJobs({
    interruptedAt = new Date().toISOString()
  } = {}) {
    const rows = await request({
      method: 'PATCH',
      query: `status=in.(${ACTIVE_STATUSES.join(',')})`,
      body: {
        status: 'failed',
        error: 'ORCHESTRATOR_RESTARTED',
        updated_at: interruptedAt,
        finished_at: interruptedAt
      }
    });

    return Array.isArray(rows)
      ? rows.map(rowToJob)
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
  createJobSupabaseAdapter,
  getConfig,
  jobToRow,
  rowToJob
};
