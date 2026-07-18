'use strict';

const crypto = require('node:crypto');
const { SupabaseStorageAdapter } = require('../../adapters/storage/supabaseStorageAdapter');

const DEFAULT_BUCKET = 'official-documents';
const DEFAULT_EXPIRES_IN = 3600;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIME_EXTENSIONS = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
});

function safeSegment(value, fallback = 'asset') {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function parseImageDataUrl(value) {
  const match = String(value || '').trim().match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const body = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!body.length) {
    const error = new Error('La imagen local está vacía');
    error.code = 'VQS_ASSET_EMPTY';
    throw error;
  }
  if (body.length > MAX_IMAGE_BYTES) {
    const error = new Error('La imagen supera el máximo permitido de 8 MB');
    error.code = 'VQS_ASSET_TOO_LARGE';
    throw error;
  }

  return { mimeType, body, extension: MIME_EXTENSIONS[mimeType] };
}

function buildAssetPath({ platformId, itemId, extension, now = new Date(), id = crypto.randomUUID() }) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${safeSegment(platformId, 'ELANVISUAL').toUpperCase()}/quotation-assets/${year}/${month}/${safeSegment(itemId, 'item')}/${safeSegment(id)}.${extension}`;
}

class QuotationAssetPersistenceService {
  constructor({ storageAdapter, bucket = process.env.VQS_DOCUMENT_BUCKET || DEFAULT_BUCKET, expiresIn = DEFAULT_EXPIRES_IN } = {}) {
    this.storageAdapter = storageAdapter || new SupabaseStorageAdapter();
    this.bucket = String(bucket || DEFAULT_BUCKET).trim();
    this.expiresIn = Number(expiresIn || DEFAULT_EXPIRES_IN);
  }

  async persistDataUrl(dataUrl, context = {}) {
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed) return null;

    const path = buildAssetPath({
      platformId: context.platformId,
      itemId: context.itemId,
      extension: parsed.extension
    });

    const upload = await this.storageAdapter.uploadObject({
      bucket: this.bucket,
      path,
      body: parsed.body,
      contentType: parsed.mimeType,
      cacheControl: '3600',
      upsert: false,
      metadata: {
        documentType: 'quotation_asset',
        platformId: context.platformId || 'ELANVISUAL',
        itemId: context.itemId || '',
        source: 'local_upload'
      }
    });

    const delivery = await this.storageAdapter.createDelivery({
      bucket: upload.bucket,
      path: upload.path,
      expiresIn: this.expiresIn
    });

    return {
      kind: 'existing-product-photo',
      bucket: upload.bucket,
      path: upload.path,
      objectPath: upload.path,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.body.length,
      signedUrl: delivery.signedUrl,
      url: delivery.signedUrl
    };
  }

  async persistInput(input = {}) {
    const platformId = input.quotation?.platformId || input.platform || 'ELANVISUAL';
    const items = Array.isArray(input.items) ? input.items : [];
    const persistedItems = [];

    for (const item of items) {
      const imageUrl = String(item?.imageUrl || '').trim();
      const persisted = await this.persistDataUrl(imageUrl, {
        platformId,
        itemId: item?.itemId || item?.id || 'item'
      });

      if (!persisted) {
        persistedItems.push(item);
        continue;
      }

      const existingImages = Array.isArray(item.images)
        ? item.images.filter((asset) => !String(asset || '').startsWith('data:image/'))
        : [];

      persistedItems.push({
        ...item,
        imageUrl: persisted.signedUrl,
        images: [persisted, ...existingImages]
      });
    }

    return { ...input, items: persistedItems };
  }
}

module.exports = {
  QuotationAssetPersistenceService,
  parseImageDataUrl,
  buildAssetPath,
  MAX_IMAGE_BYTES
};
