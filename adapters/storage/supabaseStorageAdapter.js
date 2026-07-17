'use strict';

const {
  getSupabaseClient
} = require('../../services/supabase/supabaseClient');

const {
  assertStorageAdapter
} = require('./storageAdapterContract');

const {
  StorageAdapterError
} = require('./storageAdapterError');

const DEFAULT_DELIVERY_SECONDS = 3600;
const DELETE_CONTEXTS = Object.freeze([
  'rollback_unpersisted_upload',
  'administrative_asset_deletion'
]);

function normalizeRequired(value, field) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw new StorageAdapterError(
      `El campo ${field} es obligatorio`,
      {
        code: 'STORAGE_INVALID_ARGUMENT',
        operation: 'validation',
        details: { field }
      }
    );
  }

  return normalized;
}

function normalizePath(path) {
  const normalized = normalizeRequired(path, 'path')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');

  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new StorageAdapterError(
      'La ruta del objeto no puede contener segmentos ".."',
      {
        code: 'STORAGE_INVALID_PATH',
        operation: 'validation',
        path: normalized
      }
    );
  }

  return normalized;
}

function encodeObjectPath(path) {
  return normalizePath(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function parseResponseBody(text, contentType = '') {
  if (!text) return null;

  if (String(contentType).includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readResponse(response) {
  const text = typeof response.text === 'function'
    ? await response.text()
    : '';

  return parseResponseBody(
    text,
    response.headers?.get?.('content-type') || ''
  );
}

function resolveErrorMessage(data, fallback) {
  if (typeof data === 'string' && data.trim()) return data.trim();

  return (
    data?.message ||
    data?.error ||
    data?.error_description ||
    fallback
  );
}

function buildHeaders(client, additional = {}) {
  return {
    apikey: client.serviceRoleKey,
    Authorization: `Bearer ${client.serviceRoleKey}`,
    ...additional
  };
}

function ensureClient(client) {
  if (
    !client ||
    !client.url ||
    !client.serviceRoleKey ||
    typeof client.fetchImpl !== 'function'
  ) {
    throw new StorageAdapterError(
      'El cliente Supabase no admite operaciones de Storage',
      {
        code: 'STORAGE_CLIENT_INVALID',
        operation: 'configuration'
      }
    );
  }

  return client;
}

function validateDeleteIntent({
  hardDelete,
  reason,
  context,
  authorized
} = {}) {
  const operation = 'deleteObject';

  if (hardDelete !== true) {
    throw new StorageAdapterError(
      'La eliminación física está bloqueada por defecto',
      {
        code: 'STORAGE_DELETE_BLOCKED',
        operation
      }
    );
  }

  const normalizedReason = String(reason || '').trim();

  if (!normalizedReason) {
    throw new StorageAdapterError(
      'La razón de eliminación es obligatoria',
      {
        code: 'STORAGE_DELETE_REASON_REQUIRED',
        operation,
        details: { field: 'reason' }
      }
    );
  }

  const normalizedContext = String(context || '').trim();

  if (!DELETE_CONTEXTS.includes(normalizedContext)) {
    throw new StorageAdapterError(
      'El contexto de eliminación no es válido',
      {
        code: 'STORAGE_DELETE_CONTEXT_INVALID',
        operation,
        details: { context: normalizedContext || null }
      }
    );
  }

  if (
    normalizedContext === 'administrative_asset_deletion' &&
    authorized !== true
  ) {
    throw new StorageAdapterError(
      'La eliminación administrativa requiere autorización explícita',
      {
        code: 'STORAGE_DELETE_UNAUTHORIZED',
        operation,
        details: { context: normalizedContext }
      }
    );
  }

  return {
    reason: normalizedReason,
    context: normalizedContext
  };
}

class SupabaseStorageAdapter {
  constructor({
    client = null,
    clientFactory = getSupabaseClient
  } = {}) {
    this.client = client;
    this.clientFactory = clientFactory;
  }

  getClient() {
    if (!this.client) {
      this.client = this.clientFactory();
    }

    return ensureClient(this.client);
  }

  buildObjectUrl(bucket, path, { authenticated = false } = {}) {
    const client = this.getClient();
    const normalizedBucket = normalizeRequired(bucket, 'bucket');
    const encodedPath = encodeObjectPath(path);
    const namespace = authenticated ? 'object/authenticated' : 'object';

    return `${client.url}/storage/v1/${namespace}/${encodeURIComponent(
      normalizedBucket
    )}/${encodedPath}`;
  }

  async uploadObject({
    bucket,
    path,
    body,
    contentType = 'application/octet-stream',
    cacheControl = '3600',
    upsert = false,
    metadata = null
  } = {}) {
    const operation = 'uploadObject';
    const normalizedBucket = normalizeRequired(bucket, 'bucket');
    const normalizedPath = normalizePath(path);

    if (
      body === undefined ||
      body === null
    ) {
      throw new StorageAdapterError(
        'El contenido del objeto es obligatorio',
        {
          code: 'STORAGE_INVALID_ARGUMENT',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          details: { field: 'body' }
        }
      );
    }

    const client = this.getClient();
    const headers = buildHeaders(client, {
      'Content-Type': String(contentType || 'application/octet-stream'),
      'Cache-Control': `max-age=${String(cacheControl || '3600')}`,
      'x-upsert': upsert ? 'true' : 'false'
    });

    if (metadata && typeof metadata === 'object') {
      headers['x-metadata'] = Buffer.from(
        JSON.stringify(metadata),
        'utf8'
      ).toString('base64');
    }

    let response;

    try {
      response = await client.fetchImpl(
        this.buildObjectUrl(normalizedBucket, normalizedPath),
        {
          method: 'POST',
          headers,
          body
        }
      );
    } catch (cause) {
      throw new StorageAdapterError(
        'No fue posible conectar con Supabase Storage',
        {
          code: 'STORAGE_UPLOAD_NETWORK_ERROR',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          cause
        }
      );
    }

    const data = await readResponse(response);

    if (!response.ok) {
      throw new StorageAdapterError(
        resolveErrorMessage(
          data,
          `Supabase Storage rechazó la carga con estado ${response.status}`
        ),
        {
          code: data?.code || 'STORAGE_UPLOAD_FAILED',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          status: response.status,
          details: data
        }
      );
    }

    return {
      bucket: normalizedBucket,
      path: normalizedPath,
      key: data?.Key || data?.key || `${normalizedBucket}/${normalizedPath}`,
      etag: response.headers?.get?.('etag') || null,
      data
    };
  }

  async objectExists({
    bucket,
    path
  } = {}) {
    const operation = 'objectExists';
    const normalizedBucket = normalizeRequired(bucket, 'bucket');
    const normalizedPath = normalizePath(path);
    const client = this.getClient();

    let response;

    try {
      response = await client.fetchImpl(
        this.buildObjectUrl(
          normalizedBucket,
          normalizedPath,
          { authenticated: true }
        ),
        {
          method: 'HEAD',
          headers: buildHeaders(client)
        }
      );
    } catch (cause) {
      throw new StorageAdapterError(
        'No fue posible comprobar el objeto en Supabase Storage',
        {
          code: 'STORAGE_EXISTS_NETWORK_ERROR',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          cause
        }
      );
    }

    if (response.ok) return true;
    if (response.status === 404) return false;

    const data = await readResponse(response);

    throw new StorageAdapterError(
      resolveErrorMessage(
        data,
        `No fue posible comprobar el objeto: estado ${response.status}`
      ),
      {
        code: data?.code || 'STORAGE_EXISTS_FAILED',
        operation,
        bucket: normalizedBucket,
        path: normalizedPath,
        status: response.status,
        details: data
      }
    );
  }

  async getObjectMetadata({
    bucket,
    path
  } = {}) {
    const operation = 'getObjectMetadata';
    const normalizedBucket = normalizeRequired(bucket, 'bucket');
    const normalizedPath = normalizePath(path);
    const client = this.getClient();

    let response;

    try {
      response = await client.fetchImpl(
        this.buildObjectUrl(
          normalizedBucket,
          normalizedPath,
          { authenticated: true }
        ),
        {
          method: 'HEAD',
          headers: buildHeaders(client)
        }
      );
    } catch (cause) {
      throw new StorageAdapterError(
        'No fue posible consultar los metadatos del objeto',
        {
          code: 'STORAGE_METADATA_NETWORK_ERROR',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          cause
        }
      );
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const data = await readResponse(response);

      throw new StorageAdapterError(
        resolveErrorMessage(
          data,
          `No fue posible consultar metadatos: estado ${response.status}`
        ),
        {
          code: data?.code || 'STORAGE_METADATA_FAILED',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          status: response.status,
          details: data
        }
      );
    }

    const headers = response.headers;

    return {
      bucket: normalizedBucket,
      path: normalizedPath,
      contentType: headers?.get?.('content-type') || null,
      contentLength: Number(headers?.get?.('content-length') || 0) || null,
      cacheControl: headers?.get?.('cache-control') || null,
      etag: headers?.get?.('etag') || null,
      lastModified: headers?.get?.('last-modified') || null,
      metadata: headers?.get?.('x-metadata') || null
    };
  }

  async createDelivery({
    bucket,
    path,
    expiresIn = DEFAULT_DELIVERY_SECONDS
  } = {}) {
    const operation = 'createDelivery';
    const normalizedBucket = normalizeRequired(bucket, 'bucket');
    const normalizedPath = normalizePath(path);
    const normalizedExpiry = Number(expiresIn);

    if (!Number.isInteger(normalizedExpiry) || normalizedExpiry <= 0) {
      throw new StorageAdapterError(
        'expiresIn debe ser un entero mayor que cero',
        {
          code: 'STORAGE_INVALID_EXPIRY',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          details: { expiresIn }
        }
      );
    }

    const client = this.getClient();

    if (
      !client.storage ||
      typeof client.storage.from !== 'function'
    ) {
      throw new StorageAdapterError(
        'El cliente Supabase no permite crear entregas firmadas',
        {
          code: 'STORAGE_SIGN_UNSUPPORTED',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath
        }
      );
    }

    let result;

    try {
      result = await client.storage
        .from(normalizedBucket)
        .createSignedUrl(normalizedPath, normalizedExpiry);
    } catch (cause) {
      throw new StorageAdapterError(
        'No fue posible crear la entrega firmada',
        {
          code: 'STORAGE_DELIVERY_NETWORK_ERROR',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          cause
        }
      );
    }

    if (result?.error || !result?.data?.signedUrl) {
      throw new StorageAdapterError(
        result?.error?.message || 'Supabase no generó una URL firmada',
        {
          code: result?.error?.code || 'STORAGE_DELIVERY_FAILED',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          status: result?.error?.status || null,
          details: result?.error || null
        }
      );
    }

    return {
      bucket: normalizedBucket,
      path: normalizedPath,
      signedUrl: result.data.signedUrl,
      expiresIn: normalizedExpiry
    };
  }

  async deleteObject({
    bucket,
    path,
    hardDelete = false,
    reason = '',
    context = '',
    authorized = false
  } = {}) {
    const operation = 'deleteObject';
    validateDeleteIntent({
      hardDelete,
      reason,
      context,
      authorized
    });

    const normalizedBucket = normalizeRequired(bucket, 'bucket');
    const normalizedPath = normalizePath(path);
    const client = this.getClient();

    let response;

    try {
      response = await client.fetchImpl(
        `${client.url}/storage/v1/object/${encodeURIComponent(normalizedBucket)}`,
        {
          method: 'DELETE',
          headers: buildHeaders(client, {
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            prefixes: [normalizedPath]
          })
        }
      );
    } catch (cause) {
      throw new StorageAdapterError(
        'No fue posible eliminar el objeto',
        {
          code: 'STORAGE_DELETE_NETWORK_ERROR',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          cause
        }
      );
    }

    const data = await readResponse(response);

    if (!response.ok) {
      throw new StorageAdapterError(
        resolveErrorMessage(
          data,
          `Supabase Storage rechazó la eliminación con estado ${response.status}`
        ),
        {
          code: data?.code || 'STORAGE_DELETE_FAILED',
          operation,
          bucket: normalizedBucket,
          path: normalizedPath,
          status: response.status,
          details: data
        }
      );
    }

    return {
      bucket: normalizedBucket,
      path: normalizedPath,
      deleted: true,
      data
    };
  }
}

assertStorageAdapter(SupabaseStorageAdapter.prototype);

module.exports = {
  SupabaseStorageAdapter,
  DEFAULT_DELIVERY_SECONDS,
  DELETE_CONTEXTS,
  validateDeleteIntent
};