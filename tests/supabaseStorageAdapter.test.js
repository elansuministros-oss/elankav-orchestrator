'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { STORAGE_ADAPTER_METHODS, assertStorageAdapter } = require('../adapters/storage/storageAdapterContract');
const { StorageAdapterError } = require('../adapters/storage/storageAdapterError');
const { SupabaseStorageAdapter } = require('../adapters/storage/supabaseStorageAdapter');

function createHeaders(values = {}) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return { get(name) { return normalized[String(name).toLowerCase()] || null; } };
}

function createResponse({ status = 200, body = '', headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeaders(headers),
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); }
  };
}

function createClient(fetchImpl) {
  return {
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-role-test',
    fetchImpl,
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, expiresIn) {
            return {
              data: {
                signedUrl: `https://example.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=test-${expiresIn}`
              },
              error: null
            };
          }
        };
      }
    }
  };
}

test('contrato declara los cinco métodos requeridos', () => {
  assert.deepEqual(STORAGE_ADAPTER_METHODS, [
    'uploadObject', 'objectExists', 'getObjectMetadata', 'createDelivery', 'deleteObject'
  ]);
});

test('assertStorageAdapter rechaza adaptadores incompletos', () => {
  assert.throws(() => assertStorageAdapter({ uploadObject() {} }), /Faltan métodos/);
});

test('SupabaseStorageAdapter satisface el contrato', () => {
  const adapter = new SupabaseStorageAdapter({ client: createClient(async () => createResponse()) });
  assert.equal(assertStorageAdapter(adapter), adapter);
});

test('uploadObject carga contenido usando service role', async () => {
  const calls = [];
  const adapter = new SupabaseStorageAdapter({
    client: createClient(async (url, options) => {
      calls.push({ url, options });
      return createResponse({
        status: 200,
        body: { Key: 'designs/client/logo.png' },
        headers: { 'content-type': 'application/json', etag: '"abc123"' }
      });
    })
  });
  const result = await adapter.uploadObject({
    bucket: 'designs', path: '/client/logo.png', body: Buffer.from('image'),
    contentType: 'image/png', upsert: true
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.supabase.co/storage/v1/object/designs/client/logo.png');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.apikey, 'service-role-test');
  assert.equal(calls[0].options.headers['x-upsert'], 'true');
  assert.equal(calls[0].options.headers['Content-Type'], 'image/png');
  assert.deepEqual(result, {
    bucket: 'designs', path: 'client/logo.png', key: 'designs/client/logo.png',
    etag: '"abc123"', data: { Key: 'designs/client/logo.png' }
  });
});

test('uploadObject normaliza errores de Supabase', async () => {
  const adapter = new SupabaseStorageAdapter({
    client: createClient(async () => createResponse({
      status: 409,
      body: { code: 'Duplicate', message: 'The resource already exists' },
      headers: { 'content-type': 'application/json' }
    }))
  });
  await assert.rejects(
    () => adapter.uploadObject({ bucket: 'designs', path: 'logo.png', body: Buffer.from('x') }),
    (error) => {
      assert.ok(error instanceof StorageAdapterError);
      assert.equal(error.code, 'Duplicate');
      assert.equal(error.operation, 'uploadObject');
      assert.equal(error.status, 409);
      return true;
    }
  );
});

test('objectExists devuelve true para objetos existentes', async () => {
  const adapter = new SupabaseStorageAdapter({
    client: createClient(async (url, options) => {
      assert.equal(options.method, 'HEAD');
      assert.match(url, /object\/authenticated\/designs\/logo\.png$/);
      return createResponse({ status: 200 });
    })
  });
  assert.equal(await adapter.objectExists({ bucket: 'designs', path: 'logo.png' }), true);
});

test('objectExists devuelve false cuando Supabase responde 404', async () => {
  const adapter = new SupabaseStorageAdapter({
    client: createClient(async () => createResponse({ status: 404 }))
  });
  assert.equal(await adapter.objectExists({ bucket: 'designs', path: 'missing.png' }), false);
});

test('getObjectMetadata devuelve metadatos normalizados', async () => {
  const adapter = new SupabaseStorageAdapter({
    client: createClient(async () => createResponse({
      status: 200,
      headers: {
        'content-type': 'image/webp', 'content-length': '2048',
        'cache-control': 'max-age=3600', etag: '"etag-1"',
        'last-modified': 'Fri, 17 Jul 2026 19:00:00 GMT'
      }
    }))
  });
  const metadata = await adapter.getObjectMetadata({ bucket: 'designs', path: 'render.webp' });
  assert.deepEqual(metadata, {
    bucket: 'designs', path: 'render.webp', contentType: 'image/webp', contentLength: 2048,
    cacheControl: 'max-age=3600', etag: '"etag-1"',
    lastModified: 'Fri, 17 Jul 2026 19:00:00 GMT', metadata: null
  });
});

test('getObjectMetadata devuelve null para objeto inexistente', async () => {
  const adapter = new SupabaseStorageAdapter({
    client: createClient(async () => createResponse({ status: 404 }))
  });
  assert.equal(await adapter.getObjectMetadata({ bucket: 'designs', path: 'missing.webp' }), null);
});

test('createDelivery genera una URL firmada temporal', async () => {
  const adapter = new SupabaseStorageAdapter({
    client: createClient(async () => createResponse())
  });
  const delivery = await adapter.createDelivery({
    bucket: 'designs', path: 'client/final.png', expiresIn: 900
  });
  assert.equal(delivery.bucket, 'designs');
  assert.equal(delivery.path, 'client/final.png');
  assert.equal(delivery.expiresIn, 900);
  assert.match(delivery.signedUrl, /token=test-900$/);
});

test('deleteObject elimina solo con intención explícita y validada', async () => {
  const calls = [];
  const adapter = new SupabaseStorageAdapter({
    client: createClient(async (url, options) => {
      calls.push({ url, options });
      return createResponse({
        status: 200,
        body: [{ name: 'client/final.png' }],
        headers: { 'content-type': 'application/json' }
      });
    })
  });
  const result = await adapter.deleteObject({
    bucket: 'designs',
    path: 'client/final.png',
    hardDelete: true,
    reason: 'Rollback after failed persistence',
    context: 'rollback_unpersisted_upload'
  });
  assert.equal(calls[0].url, 'https://example.supabase.co/storage/v1/object/designs');
  assert.equal(calls[0].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[0].options.body), { prefixes: ['client/final.png'] });
  assert.deepEqual(result, {
    bucket: 'designs', path: 'client/final.png', deleted: true,
    context: 'rollback_unpersisted_upload'
  });
});

test('rechaza rutas con navegación hacia directorios superiores', async () => {
  const adapter = new SupabaseStorageAdapter({
    client: createClient(async () => createResponse())
  });
  await assert.rejects(
    () => adapter.objectExists({ bucket: 'designs', path: '../secret.txt' }),
    (error) => {
      assert.ok(error instanceof StorageAdapterError);
      assert.equal(error.code, 'STORAGE_INVALID_PATH');
      return true;
    }
  );
});
