'use strict';

const { getConfig } = require('./jobSupabaseAdapter');

const TABLE_NAME = 'design_requests';
const BUCKET_NAME = 'design-request-assets';
const MAX_ASSET_BYTES = 12 * 1024 * 1024;

function createHeaders(key, legacyJwt, extra = {}) {
  const headers = { apikey: key, ...extra };
  if (legacyJwt) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function createDesignPortalSupabaseAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const request = async ({ method = 'GET', query = '', body } = {}) => {
    const { url, key, legacyJwt } = getConfig(env);
    const response = await fetchImpl(
      `${url}/rest/v1/${TABLE_NAME}${query ? `?${query}` : ''}`,
      {
        method,
        headers: createHeaders(key, legacyJwt, {
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        }),
        body: body === undefined ? undefined : JSON.stringify(body)
      }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) {
      const error = new Error('DESIGN_QUEUE_REQUEST_FAILED');
      error.code = 'DESIGN_QUEUE_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    return data;
  };

  async function getNextPending() {
    const rows = await request({
      query: 'select=*&status=eq.ai_pending&order=created_at.asc&limit=1'
    });
    return rows[0] || null;
  }

  async function findRequestByCode(requestCode) {
    const rows = await request({
      query: `select=*&request_code=eq.${encodeURIComponent(requestCode)}&limit=1`
    });
    return rows[0] || null;
  }

  async function queueFollowup(id, values, now = new Date().toISOString()) {
    const rows = await request({
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(id)}&status=in.(review,ready)`,
      body: {
        ...values,
        status: 'ai_pending',
        processing_started_at: null,
        processing_attempts: 0,
        completed_at: null,
        last_error_code: null,
        delivery_status: 'pending',
        delivery_attempts: 0,
        delivery_last_attempt_at: null,
        delivery_error_code: null,
        delivered_at: null,
        updated_at: now
      }
    });
    return rows[0] || null;
  }

  async function claimRequest(id, attempts = 0, now = new Date().toISOString()) {
    const rows = await request({
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(id)}&status=eq.ai_pending`,
      body: {
        status: 'designing',
        processing_started_at: now,
        processing_attempts: Number(attempts || 0) + 1,
        last_error_code: null,
        updated_at: now
      }
    });
    return rows[0] || null;
  }

  async function recoverStaleRequests(now = new Date()) {
    const staleBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    return request({
      method: 'PATCH',
      query: `status=eq.designing&processing_started_at=lt.${encodeURIComponent(staleBefore)}`,
      body: {
        status: 'ai_pending',
        processing_started_at: null,
        last_error_code: 'DESIGN_WORKER_INTERRUPTED',
        updated_at: now.toISOString()
      }
    });
  }

  async function downloadAsset(file) {
    const { url, key, legacyJwt } = getConfig(env);
    const bucket = String(file?.bucket || BUCKET_NAME);
    const path = String(file?.path || '');
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetchImpl(
      `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
      { headers: createHeaders(key, legacyJwt) }
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = String(file?.mimeType || response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!response.ok || !buffer.length || buffer.length > MAX_ASSET_BYTES) {
      const error = new Error('DESIGN_INPUT_ASSET_INVALID');
      error.code = 'DESIGN_INPUT_ASSET_INVALID';
      throw error;
    }

    return Object.freeze({
      kind: String(file?.kind || 'reference'),
      buffer,
      mimeType,
      fileName: String(file?.name || 'reference')
    });
  }

  async function uploadResult({ requestCode, kind, asset }) {
    const { url, key, legacyJwt } = getConfig(env);
    const safeKind = String(kind || 'render').replace(/[^a-z0-9-]/gi, '-');
    const path = `${requestCode}/${safeKind}-${crypto.randomUUID()}.png`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetchImpl(
      `${url}/storage/v1/object/${BUCKET_NAME}/${encodedPath}`,
      {
        method: 'POST',
        headers: createHeaders(key, legacyJwt, {
          'Content-Type': 'image/png',
          'x-upsert': 'false'
        }),
        body: asset.buffer
      }
    );
    if (!response.ok) {
      const error = new Error('DESIGN_RESULT_UPLOAD_FAILED');
      error.code = 'DESIGN_RESULT_UPLOAD_FAILED';
      throw error;
    }
    return Object.freeze({
      kind,
      bucket: BUCKET_NAME,
      path,
      mimeType: 'image/png',
      sizeBytes: asset.buffer.length
    });
  }

  async function completeRequest(id, { resultFiles, designResult }, now = new Date().toISOString()) {
    const rows = await request({
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(id)}&status=eq.designing`,
      body: {
        status: 'review',
        result_files: resultFiles,
        design_result: designResult,
        completed_at: now,
        last_error_code: null,
        updated_at: now
      }
    });
    return rows[0] || null;
  }

  async function failRequest(id, errorCode, now = new Date().toISOString()) {
    const rows = await request({
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(id)}&status=eq.designing`,
      body: {
        status: 'failed',
        last_error_code: String(errorCode || 'DESIGN_PROCESSING_FAILED').slice(0, 120),
        completed_at: now,
        updated_at: now
      }
    });
    return rows[0] || null;
  }


  async function retryRequest(id, errorCode, now = new Date().toISOString()) {
    const rows = await request({
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(id)}&status=eq.designing`,
      body: {
        status: 'ai_pending',
        processing_started_at: null,
        last_error_code: String(errorCode || 'DESIGN_PROCESSING_FAILED').slice(0, 120),
        updated_at: now
      }
    });
    return rows[0] || null;
  }

  return Object.freeze({
    claimRequest,
    completeRequest,
    downloadAsset,
    failRequest,
    findRequestByCode,
    getNextPending,
    recoverStaleRequests,
    queueFollowup,
    retryRequest,
    uploadResult
  });
}

module.exports = {
  BUCKET_NAME,
  MAX_ASSET_BYTES,
  TABLE_NAME,
  createDesignPortalSupabaseAdapter
};
