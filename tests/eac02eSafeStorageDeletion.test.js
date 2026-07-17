'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { StorageAdapterError } = require('../adapters/storage/storageAdapterError');
const { SupabaseStorageAdapter } = require('../adapters/storage/supabaseStorageAdapter');
const { QuotationPdfRenderer } = require('../services/vqs/quotationPdfRenderer');
const { QuotationDocumentDeliveryService } = require('../services/vqs/quotationDocumentDeliveryService');

function response({ status = 200, body = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() { return JSON.stringify(body); }
  };
}

function adapterWithCalls(calls, fetchResult = response()) {
  return new SupabaseStorageAdapter({
    client: {
      url: 'https://example.supabase.co',
      serviceRoleKey: 'test-key',
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (fetchResult instanceof Error) throw fetchResult;
        return fetchResult;
      },
      storage: {
        from() {
          return {
            async createSignedUrl() {
              return { data: { signedUrl: 'https://signed.example/file' }, error: null };
            }
          };
        }
      }
    }
  });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof StorageAdapterError);
    assert.equal(error.code, code);
    return true;
  });
}

test('deleteObject sin hardDelete queda bloqueado y no llama Supabase', async () => {
  const calls = [];
  const adapter = adapterWithCalls(calls);
  await expectCode(adapter.deleteObject({ bucket: 'docs', path: 'a.pdf' }), 'STORAGE_DELETE_BLOCKED');
  assert.equal(calls.length, 0);
});

test('deleteObject con hardDelete false queda bloqueado', async () => {
  const calls = [];
  const adapter = adapterWithCalls(calls);
  await expectCode(adapter.deleteObject({
    bucket: 'docs', path: 'a.pdf', hardDelete: false
  }), 'STORAGE_DELETE_BLOCKED');
  assert.equal(calls.length, 0);
});

test('hardDelete true exige reason', async () => {
  const calls = [];
  const adapter = adapterWithCalls(calls);
  await expectCode(adapter.deleteObject({
    bucket: 'docs', path: 'a.pdf', hardDelete: true,
    context: 'rollback_unpersisted_upload'
  }), 'STORAGE_DELETE_REASON_REQUIRED');
  assert.equal(calls.length, 0);
});

test('hardDelete true exige context válido', async () => {
  const calls = [];
  const adapter = adapterWithCalls(calls);
  await expectCode(adapter.deleteObject({
    bucket: 'docs', path: 'a.pdf', hardDelete: true, reason: 'cleanup'
  }), 'STORAGE_DELETE_CONTEXT_INVALID');
  await expectCode(adapter.deleteObject({
    bucket: 'docs', path: 'a.pdf', hardDelete: true, reason: 'cleanup', context: 'unknown'
  }), 'STORAGE_DELETE_CONTEXT_INVALID');
  assert.equal(calls.length, 0);
});

test('administrative_asset_deletion exige authorized true', async () => {
  const calls = [];
  const adapter = adapterWithCalls(calls);
  await expectCode(adapter.deleteObject({
    bucket: 'docs', path: 'a.pdf', hardDelete: true, reason: 'approved removal',
    context: 'administrative_asset_deletion'
  }), 'STORAGE_DELETE_UNAUTHORIZED');
  assert.equal(calls.length, 0);
});

test('rollback_unpersisted_upload válido elimina y devuelve respuesta normalizada', async () => {
  const calls = [];
  const adapter = adapterWithCalls(calls, response({ body: [{ name: 'a.pdf' }] }));
  const result = await adapter.deleteObject({
    bucket: 'docs', path: 'a.pdf', hardDelete: true,
    reason: 'Persistence failed after upload', context: 'rollback_unpersisted_upload'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[0].options.body), { prefixes: ['a.pdf'] });
  assert.deepEqual(result, {
    bucket: 'docs', path: 'a.pdf', deleted: true,
    context: 'rollback_unpersisted_upload'
  });
});

test('administrative_asset_deletion autorizado elimina', async () => {
  const calls = [];
  const adapter = adapterWithCalls(calls);
  const result = await adapter.deleteObject({
    bucket: 'docs', path: 'historic.pdf', hardDelete: true,
    reason: 'Asset deletion approved by administrator',
    context: 'administrative_asset_deletion', authorized: true
  });
  assert.equal(result.deleted, true);
  assert.equal(calls.length, 1);
});

test('fallo de proveedor usa STORAGE_DELETE_FAILED', async () => {
  const adapter = adapterWithCalls([], response({
    status: 500,
    body: { code: 'provider-secret-code', message: 'provider failure' }
  }));
  await expectCode(adapter.deleteObject({
    bucket: 'docs', path: 'a.pdf', hardDelete: true, reason: 'rollback',
    context: 'rollback_unpersisted_upload'
  }), 'STORAGE_DELETE_FAILED');
});

test('fallo de red usa STORAGE_DELETE_NETWORK_ERROR', async () => {
  const adapter = adapterWithCalls([], new Error('network down'));
  await expectCode(adapter.deleteObject({
    bucket: 'docs', path: 'a.pdf', hardDelete: true, reason: 'rollback',
    context: 'rollback_unpersisted_upload'
  }), 'STORAGE_DELETE_NETWORK_ERROR');
});

test('Document Delivery ejecuta rollback explícito al fallar persistencia', async () => {
  const deleted = [];
  const storageAdapter = {
    async uploadObject(input) { return { bucket: input.bucket, path: input.path }; },
    async objectExists() { return true; },
    async getObjectMetadata() { return null; },
    async createDelivery() { throw new Error('no debe ejecutarse'); },
    async deleteObject(input) { deleted.push(input); return { deleted: true }; }
  };
  const service = new QuotationDocumentDeliveryService({
    storageAdapter,
    pdfRenderer: new QuotationPdfRenderer(),
    quotationRepository: {
      async updateQuotation() { throw new Error('persistencia falló'); }
    }
  });

  await assert.rejects(service.deliver({
    quotationDocument: {
      schemaVersion: '1.0.0',
      platformId: 'ELANVISUAL',
      quotationNumber: 'COT-1',
      publicDocument: { quotationId: 'q1' }
    },
    quotation: { id: 'q1', quotation_number: 'COT-1' },
    project: { id: 'p1' }
  }), /persistencia falló/);

  assert.deepEqual(deleted, [{
    bucket: 'official-documents',
    path: 'ELANVISUAL/quotations/q1/COT-1.pdf',
    hardDelete: true,
    reason: 'Quotation persistence failed after upload',
    context: 'rollback_unpersisted_upload'
  }]);
});
