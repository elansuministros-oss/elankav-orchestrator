'use strict';

const DEFAULT_EXPIRES_IN = 3600;

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

  const bucket = firstText(delivery.bucket, delivery.storageBucket, delivery.storage_bucket);
  const path = firstText(
    delivery.path,
    delivery.objectPath,
    delivery.object_path,
    delivery.storagePath,
    delivery.storage_path
  );

  if (!bucket || !path) return null;

  return {
    ...delivery,
    bucket,
    path
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
  refreshPublicQuotationDelivery
};
