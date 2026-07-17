'use strict';

const DEFAULT_EXPIRES_IN = 3600;
const STORAGE_PATH_FIELDS = ['path', 'objectPath', 'object_path', 'storagePath', 'storage_path'];
const STORAGE_BUCKET_FIELDS = ['bucket', 'storageBucket', 'storage_bucket'];
const URL_FIELDS = ['url', 'src', 'imageUrl', 'publicUrl', 'signedUrl', 'downloadUrl'];

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function resolveStoredDelivery(quotation = {}) {
  const relations = safeObject(quotation.relations);
  const delivery = safeObject(
    relations.documentDelivery ||
    relations.document_delivery ||
    quotation.documentDelivery ||
    quotation.document_delivery
  );

  const bucket = firstText(...STORAGE_BUCKET_FIELDS.map((field) => delivery[field]));
  const path = firstText(...STORAGE_PATH_FIELDS.map((field) => delivery[field]));

  if (!bucket || !path) return null;

  return {
    ...delivery,
    bucket,
    path
  };
}

function parseSupabaseStorageLocation(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const marker = '/storage/v1/object/sign/';
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const storagePath = url.pathname.slice(markerIndex + marker.length);
    const separatorIndex = storagePath.indexOf('/');
    if (separatorIndex <= 0 || separatorIndex === storagePath.length - 1) return null;

    return {
      bucket: decodeURIComponent(storagePath.slice(0, separatorIndex)),
      path: storagePath
        .slice(separatorIndex + 1)
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/')
    };
  } catch {
    return null;
  }
}

function resolveAssetStorageLocation(asset) {
  if (typeof asset === 'string') return parseSupabaseStorageLocation(asset);
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return null;

  const bucket = firstText(...STORAGE_BUCKET_FIELDS.map((field) => asset[field]));
  const path = firstText(...STORAGE_PATH_FIELDS.map((field) => asset[field]));
  if (bucket && path) return { bucket, path };

  for (const field of URL_FIELDS) {
    const location = parseSupabaseStorageLocation(asset[field]);
    if (location) return location;
  }

  return null;
}

async function refreshAsset(asset, storageAdapter, expiresIn) {
  const location = resolveAssetStorageLocation(asset);
  if (!location) return asset;

  const delivery = await storageAdapter.createDelivery({
    bucket: location.bucket,
    path: location.path,
    expiresIn
  });

  const signedUrl = delivery.signedUrl;
  if (typeof asset === 'string') return signedUrl;

  const refreshed = { ...asset };
  let replaced = false;
  for (const field of URL_FIELDS) {
    if (field in refreshed) {
      refreshed[field] = signedUrl;
      replaced = true;
    }
  }
  if (!replaced) refreshed.signedUrl = signedUrl;
  return refreshed;
}

async function refreshPublicQuotationImages({
  quotationDocument,
  storageAdapter,
  expiresIn = DEFAULT_EXPIRES_IN
} = {}) {
  if (!quotationDocument || typeof quotationDocument !== 'object') return quotationDocument;
  if (!storageAdapter || typeof storageAdapter.createDelivery !== 'function') {
    const error = new Error('Se requiere storageAdapter.createDelivery()');
    error.code = 'PUBLIC_QUOTATION_DELIVERY_INVALID';
    throw error;
  }

  const publicDocument = safeObject(quotationDocument.publicDocument);
  const items = Array.isArray(publicDocument.items) ? publicDocument.items : [];

  const refreshedItems = await Promise.all(items.map(async (item = {}) => {
    const refreshedImageUrl = await refreshAsset(item.imageUrl, storageAdapter, expiresIn);
    const refreshedImages = Array.isArray(item.images)
      ? await Promise.all(item.images.map((asset) => refreshAsset(asset, storageAdapter, expiresIn)))
      : item.images;

    return {
      ...item,
      imageUrl: refreshedImageUrl,
      images: refreshedImages
    };
  }));

  const project = safeObject(publicDocument.project);
  const refreshedProjectImages = Array.isArray(project.images)
    ? await Promise.all(project.images.map((asset) => refreshAsset(asset, storageAdapter, expiresIn)))
    : project.images;

  return {
    ...quotationDocument,
    publicDocument: {
      ...publicDocument,
      items: refreshedItems,
      project: {
        ...project,
        images: refreshedProjectImages
      }
    }
  };
}

async function refreshPublicQuotationDelivery({
  quotation,
  storageAdapter,
  expiresIn = DEFAULT_EXPIRES_IN
} = {}) {
  const stored = resolveStoredDelivery(quotation);
  if (!stored) return null;

  if (!storageAdapter || typeof storageAdapter.createDelivery !== 'function') {
    const error = new Error('Se requiere storageAdapter.createDelivery()');
    error.code = 'PUBLIC_QUOTATION_DELIVERY_INVALID';
    throw error;
  }

  const delivery = await storageAdapter.createDelivery({
    bucket: stored.bucket,
    path: stored.path,
    expiresIn
  });

  return {
    ...stored,
    bucket: delivery.bucket || stored.bucket,
    path: delivery.path || stored.path,
    signedUrl: delivery.signedUrl,
    expiresIn: delivery.expiresIn
  };
}

module.exports = {
  DEFAULT_EXPIRES_IN,
  resolveStoredDelivery,
  parseSupabaseStorageLocation,
  resolveAssetStorageLocation,
  refreshPublicQuotationImages,
  refreshPublicQuotationDelivery
};