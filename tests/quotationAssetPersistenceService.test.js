'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QuotationAssetPersistenceService,
  parseImageDataUrl,
  buildAssetPath,
  resolveVqsAssetBucket
} = require('../services/vqs/quotationAssetPersistenceService');

const SMALL_PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('parsea una imagen local permitida', () => {
  const parsed = parseImageDataUrl(SMALL_PNG);
  assert.equal(parsed.mimeType, 'image/png');
  assert.equal(parsed.extension, 'png');
  assert.ok(Buffer.isBuffer(parsed.body));
});

test('rechaza contenido que no sea imagen local permitida', () => {
  assert.equal(parseImageDataUrl('data:text/plain;base64,SG9sYQ=='), null);
  assert.equal(parseImageDataUrl('https://example.com/photo.png'), null);
});

test('construye ruta estable dentro del bucket existente', () => {
  const path = buildAssetPath({
    platformId: 'ELANVISUAL',
    itemId: 'item 1',
    extension: 'webp',
    now: new Date('2026-07-18T00:00:00Z'),
    id: 'asset-1'
  });
  assert.equal(path, 'ELANVISUAL/quotation-assets/2026/07/item-1/asset-1.webp');
});

test('requiere VQS_ASSET_BUCKET al subir imagenes', async () => {
  const service = new QuotationAssetPersistenceService({
    env: {},
    storageAdapter: {
      async uploadObject() { throw new Error('uploadObject no debe ejecutarse'); },
      async createDelivery() { throw new Error('createDelivery no debe ejecutarse'); }
    }
  });

  await assert.rejects(
    () => service.persistDataUrl(SMALL_PNG, { platformId: 'ELANVISUAL', itemId: 'item-1' }),
    (error) => error.code === 'VQS_ASSET_BUCKET_REQUIRED'
  );
  assert.equal(resolveVqsAssetBucket({ env: { VQS_ASSET_BUCKET: 'elanvisual' } }), 'elanvisual');
});

test('sube y firma una imagen local sin persistir el data URL', async () => {
  const calls = [];
  const storageAdapter = {
    async uploadObject(input) {
      calls.push(['upload', input]);
      return { bucket: input.bucket, path: input.path };
    },
    async createDelivery(input) {
      calls.push(['delivery', input]);
      return { ...input, signedUrl: 'https://storage.example/signed-image' };
    }
  };
  const service = new QuotationAssetPersistenceService({ storageAdapter, bucket: 'elanvisual' });
  const asset = await service.persistDataUrl(SMALL_PNG, { platformId: 'ELANVISUAL', itemId: 'item-1' });

  assert.equal(asset.bucket, 'elanvisual');
  assert.equal(asset.kind, 'quotation-image');
  assert.equal(asset.itemId, 'item-1');
  assert.match(asset.assetId, /^[0-9a-f-]{36}$/i);
  assert.equal(asset.mimeType, 'image/png');
  assert.equal(asset.signedUrl, 'https://storage.example/signed-image');
  assert.ok(Buffer.isBuffer(calls[0][1].body));
  assert.equal(String(calls[0][1].body).includes('data:image'), false);
});

test('reemplaza data URL por referencia persistente antes de crear la cotización', async () => {
  const service = new QuotationAssetPersistenceService({
    bucket: 'elanvisual',
    storageAdapter: {
      async uploadObject(input) { return { bucket: input.bucket, path: input.path }; },
      async createDelivery(input) { return { ...input, signedUrl: 'https://storage.example/photo' }; }
    }
  });

  const result = await service.persistInput({
    quotation: { platformId: 'ELANVISUAL' },
    items: [{ itemId: 'item-1', imageUrl: SMALL_PNG, images: [SMALL_PNG] }]
  });

  assert.equal(result.items[0].imageUrl, 'https://storage.example/photo');
  assert.equal(result.items[0].images[0].bucket, 'elanvisual');
  assert.equal(result.items[0].images[0].kind, 'quotation-image');
  assert.equal(result.items[0].images[0].itemId, 'item-1');
  assert.equal(result.items[0].images[0].path.includes('/quotation-assets/'), true);
});
