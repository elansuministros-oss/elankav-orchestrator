const test = require('node:test');
const assert = require('node:assert/strict');
const { SupabaseVqsContextAdapter } = require('../adapters/vqsContext/supabaseVqsContextAdapter');
const { SupabaseRestClient } = require('../services/supabase/supabaseClient');

function queryResult(rows) {
  return {
    select() { return this; },
    order() { return this; },
    limit() { return Promise.resolve({ data: rows, error: null }); }
  };
}

function createSupabaseFixture({ rows, signedUrls = {}, failures = new Set() }) {
  const calls = { signed: [] };
  return {
    calls,
    supabase: {
      from() {
        return queryResult(rows);
      },
      storage: {
        from(bucket) {
          return {
            async createSignedUrl(path, expiresIn) {
              calls.signed.push({ bucket, path, expiresIn });
              if (failures.has(path)) return { data: null, error: { code: 'SIGN_FAILED' } };
              return { data: { signedUrl: signedUrls[path] || `https://storage.test/${path}?token=redacted` }, error: null };
            }
          };
        }
      }
    }
  };
}

function designRow(overrides = {}) {
  return {
    id: 'request-1',
    request_code: 'DESIGN-MRNTUFAI-A8B0',
    customer_name: 'Cliente',
    business_name: 'Negocio',
    request_type: 'rotulo',
    design_notes: 'Propuesta visual',
    files: [],
    result_files: [],
    ...overrides
  };
}

test('DESIGN-CONTEXT-ASSET-01 usa result_files, firma assets visuales y prioriza generated-render', async () => {
  const row = designRow({
    result_files: [
      {
        kind: 'generated-logo',
        bucket: 'design-request-assets',
        path: 'DESIGN-MRNTUFAI-A8B0/generated-logo.png',
        mimeType: 'image/jpeg',
        sizeBytes: 111
      },
      {
        kind: 'generated-render',
        bucket: 'design-request-assets',
        path: 'DESIGN-MRNTUFAI-A8B0/generated-render.png',
        mimeType: 'image/png',
        sizeBytes: 123456
      },
      {
        kind: 'brief',
        bucket: 'design-request-assets',
        path: 'DESIGN-MRNTUFAI-A8B0/brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 444
      }
    ],
    files: [
      {
        kind: 'generated-render',
        bucket: 'design-request-assets',
        path: 'DESIGN-MRNTUFAI-A8B0/generated-render.png',
        mimeType: 'image/png',
        sizeBytes: 123456
      },
      {
        kind: 'reference',
        bucket: 'design-request-assets',
        path: 'DESIGN-MRNTUFAI-A8B0/reference.webp',
        mimeType: 'image/webp',
        sizeBytes: 222
      }
    ]
  });
  const { supabase, calls } = createSupabaseFixture({
    rows: [row],
    signedUrls: {
      'DESIGN-MRNTUFAI-A8B0/generated-render.png': 'https://storage.test/render.png?token=redacted',
      'DESIGN-MRNTUFAI-A8B0/generated-logo.png': 'https://storage.test/logo.png?token=redacted',
      'DESIGN-MRNTUFAI-A8B0/reference.webp': 'https://storage.test/reference.webp?token=redacted'
    }
  });
  const adapter = new SupabaseVqsContextAdapter({ supabase, logger: { warn() {} } });

  const results = await adapter.search('DESIGN-MRNTUFAI-A8B0', { types: ['design'] });

  assert.equal(results.length, 1);
  const item = results[0].items[0];
  assert.equal(item.imageUrl, 'https://storage.test/render.png?token=redacted');
  assert.deepEqual(calls.signed[0], {
    bucket: 'design-request-assets',
    path: 'DESIGN-MRNTUFAI-A8B0/generated-render.png',
    expiresIn: 3600
  });
  assert.deepEqual(item.images.map((asset) => asset.path), [
    'DESIGN-MRNTUFAI-A8B0/generated-render.png',
    'DESIGN-MRNTUFAI-A8B0/generated-logo.png',
    'DESIGN-MRNTUFAI-A8B0/reference.webp'
  ]);
  assert.equal(item.images[0].kind, 'generated-render');
  assert.equal(item.images[0].bucket, 'design-request-assets');
  assert.equal(item.images[0].mimeType, 'image/png');
  assert.equal(item.images[0].sizeBytes, 123456);
  assert.equal(item.images[0].signedUrl, 'https://storage.test/render.png?token=redacted');
  assert.equal(item.images.some((asset) => asset.mimeType === 'application/pdf'), false);
  assert.equal(item.images.filter((asset) => asset.path.endsWith('generated-render.png')).length, 1);
});

test('DESIGN-CONTEXT-ASSET-01 mantiene compatibilidad con row.files', async () => {
  const row = designRow({
    request_code: 'DESIGN-FILES-0001',
    result_files: [],
    files: [{
      kind: 'reference',
      bucket: 'design-request-assets',
      path: 'DESIGN-FILES-0001/reference.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 333
    }]
  });
  const { supabase } = createSupabaseFixture({
    rows: [row],
    signedUrls: {
      'DESIGN-FILES-0001/reference.jpg': 'https://storage.test/reference.jpg?token=redacted'
    }
  });
  const adapter = new SupabaseVqsContextAdapter({ supabase, logger: { warn() {} } });

  const results = await adapter.search('DESIGN-FILES-0001', { types: ['design'] });

  assert.equal(results[0].items[0].imageUrl, 'https://storage.test/reference.jpg?token=redacted');
  assert.equal(results[0].items[0].images[0].signedUrl, 'https://storage.test/reference.jpg?token=redacted');
});

test('DESIGN-CONTEXT-ASSET-01 no rompe la busqueda si falla una firma', async () => {
  const warnings = [];
  const row = designRow({
    result_files: [{
      kind: 'generated-render',
      bucket: 'design-request-assets',
      path: 'DESIGN-MRNTUFAI-A8B0/generated-render.png',
      mimeType: 'image/png',
      sizeBytes: 123456
    }]
  });
  const { supabase } = createSupabaseFixture({
    rows: [row],
    failures: new Set(['DESIGN-MRNTUFAI-A8B0/generated-render.png'])
  });
  const adapter = new SupabaseVqsContextAdapter({
    supabase,
    logger: { warn: (...args) => warnings.push(args) }
  });

  const results = await adapter.search('DESIGN-MRNTUFAI-A8B0', { types: ['design'] });

  assert.equal(results.length, 1);
  assert.equal(results[0].items[0].imageUrl, '');
  assert.equal(results[0].items[0].images[0].path, 'DESIGN-MRNTUFAI-A8B0/generated-render.png');
  assert.equal('signedUrl' in results[0].items[0].images[0], false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[VQS_CONTEXT_ASSET_SIGN_ERROR]');
  assert.equal(warnings[0][1].code, 'SIGN_FAILED');
});

test('DESIGN-CONTEXT-ASSET-01 el cliente Supabase REST expone createSignedUrl compatible', async () => {
  const calls = [];
  const client = new SupabaseRestClient({
    url: 'https://demo.supabase.co',
    serviceRoleKey: 'service-role',
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            signedURL: '/object/sign/design-request-assets/DESIGN-TEST/render.png?token=redacted'
          });
        }
      };
    }
  });

  const result = await client.storage
    .from('design-request-assets')
    .createSignedUrl('DESIGN-TEST/render.png', 3600);

  assert.equal(
    calls[0].url,
    'https://demo.supabase.co/storage/v1/object/sign/design-request-assets/DESIGN-TEST/render.png'
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), { expiresIn: 3600 });
  assert.equal(
    result.data.signedUrl,
    'https://demo.supabase.co/storage/v1/object/sign/design-request-assets/DESIGN-TEST/render.png?token=redacted'
  );
});
