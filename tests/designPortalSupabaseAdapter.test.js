'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDesignPortalSupabaseAdapter,
  assertResolvableImageAsset
} = require('../adapters/designPortalSupabaseAdapter');

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}

test('DESIGN-DELIVERY-CLOSE-02 resuelve un asset visual con URL firmada de Supabase', async () => {
  const calls = [];
  const adapter = createDesignPortalSupabaseAdapter({
    env: {
      SUPABASE_URL: 'https://demo.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role'
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return jsonResponse({
        signedURL: '/object/sign/design-request-assets/DESIGN-TEST/render.png?token=redacted'
      });
    }
  });

  const asset = await adapter.resolveDesignAsset({
    kind: 'generated-render',
    bucket: 'design-request-assets',
    path: 'DESIGN-TEST/render.png',
    mimeType: 'image/png',
    sizeBytes: 123
  }, { expiresIn: 120 });

  assert.equal(
    calls[0].url,
    'https://demo.supabase.co/storage/v1/object/sign/design-request-assets/DESIGN-TEST/render.png'
  );
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.apikey, 'service-role');
  assert.deepEqual(JSON.parse(calls[0].options.body), { expiresIn: 120 });
  assert.equal(
    asset.signedUrl,
    'https://demo.supabase.co/storage/v1/object/sign/design-request-assets/DESIGN-TEST/render.png?token=redacted'
  );
  assert.equal(asset.bucket, 'design-request-assets');
  assert.equal(asset.path, 'DESIGN-TEST/render.png');
});

test('DESIGN-DELIVERY-CLOSE-02 rechaza assets no visuales para entrega', () => {
  assert.throws(
    () => assertResolvableImageAsset({
      bucket: 'design-request-assets',
      path: 'DESIGN-TEST/document.pdf',
      mimeType: 'application/pdf'
    }),
    /DESIGN_ASSET_UNSUPPORTED_MIME_TYPE/
  );
});
