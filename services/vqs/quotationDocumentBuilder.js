const { resolveQuotationTemplate } = require('./documentTemplateService');

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const PUBLIC_IMAGE_URL_FIELDS = ['url', 'src', 'imageUrl', 'publicUrl', 'signedUrl', 'downloadUrl'];
const PUBLIC_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EXCLUDED_PUBLIC_IMAGE_KINDS = new Set(['place', 'reference']);

function toValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveIssuedAt({ document, quotation, now = new Date() } = {}) {
  const issuedAt =
    toValidDate(document?.quotation?.issuedAt) ||
    toValidDate(quotation?.issued_at) ||
    toValidDate(quotation?.created_at) ||
    toValidDate(now) ||
    new Date();

  return issuedAt.toISOString();
}

function resolveValidUntil({ document, quotation, issuedAt, now = new Date() } = {}) {
  const explicitValidUntil =
    toValidDate(document?.quotation?.validUntil) ||
    toValidDate(quotation?.valid_until);

  if (explicitValidUntil) return explicitValidUntil.toISOString();

  const baseDate =
    toValidDate(issuedAt) ||
    toValidDate(document?.quotation?.issuedAt) ||
    toValidDate(quotation?.created_at) ||
    toValidDate(now) ||
    new Date();
  const validUntil = new Date(baseDate.getTime());
  validUntil.setUTCDate(validUntil.getUTCDate() + 15);

  return validUntil.toISOString();
}

function isPublicImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return value.startsWith('/');
  }
}

function getAssetUrl(asset) {
  if (typeof asset === 'string') return isPublicImageUrl(asset) ? asset : '';
  if (!asset || typeof asset !== 'object') return '';

  for (const field of PUBLIC_IMAGE_URL_FIELDS) {
    const value = asset[field];
    if (isPublicImageUrl(value)) return value;
  }

  return '';
}

function isVisualAsset(asset) {
  if (typeof asset === 'string') return isPublicImageUrl(asset);
  if (!asset || typeof asset !== 'object') return false;
  if (EXCLUDED_PUBLIC_IMAGE_KINDS.has(asset.kind)) return false;
  const mimeType = typeof asset.mimeType === 'string' ? asset.mimeType.toLowerCase() : '';
  return PUBLIC_IMAGE_MIME_TYPES.has(mimeType) && Boolean(getAssetUrl(asset));
}

function resolvePrimaryImage(item = {}) {
  if (isPublicImageUrl(item.imageUrl)) return item.imageUrl;

  const images = Array.isArray(item.images) ? item.images : [];
  const generatedRender = images.find((asset) => asset?.kind === 'generated-render' && isVisualAsset(asset));
  if (generatedRender) return getAssetUrl(generatedRender);

  const visualAsset = images.find(isVisualAsset);
  if (visualAsset) return getAssetUrl(visualAsset);

  const urlAsset = images.find((asset) => isPublicImageUrl(getAssetUrl(asset)));
  return urlAsset ? getAssetUrl(urlAsset) : '';
}

function sanitizeItem(item = {}) {
  const quantity = asNumber(item.quantity, 1);
  const unitPrice = asNumber(item.unitPriceUsd ?? item.unitPrice);
  const subtotal = asNumber(item.subtotalUsd ?? item.subtotal, quantity * unitPrice);
  const imageUrl = resolvePrimaryImage(item);

  return {
    id: item.itemId || item.id || '',
    productId: item.productId || '',
    designId: item.designId || '',
    title: item.title || '',
    description: item.description || '',
    quantity,
    unit: item.unit || 'unidad',
    unitPrice,
    subtotal,
    imageUrl,
    images: imageUrl ? [imageUrl] : [],
    features: Array.isArray(item.features) ? [...item.features] : []
  };
}

function buildQuotationDocument({ document, quotation, project } = {}) {
  if (!document || !quotation || !project) {
    const error = new Error('document, quotation y project son obligatorios');
    error.code = 'VQS_DOCUMENT_BUILD_INPUT_INVALID';
    throw error;
  }

  const items = Array.isArray(document.items) ? document.items.map(sanitizeItem) : [];
  const subtotal = asNumber(document.pricing?.subtotalUsd, items.reduce((sum, item) => sum + item.subtotal, 0));
  const discount = asNumber(document.pricing?.discountUsd);
  const tax = asNumber(document.pricing?.taxUsd);
  const total = asNumber(document.pricing?.totalUsd, subtotal - discount + tax);
  const issuedAt = resolveIssuedAt({ document, quotation });
  const validUntil = resolveValidUntil({ document, quotation, issuedAt });
  const projectImageUrl = resolvePrimaryImage({ images: document.project?.images });

  const quotationDocument = {
    schemaVersion: '1.0.0',
    documentType: 'quotation',
    platformId: document.quotation.platformId,
    quotationId: quotation.id,
    quotationNumber: quotation.quotation_number,
    issuedAt,
    validUntil,
    projectId: project.id,
    projectNumber: project.project_number,
    customer: { ...document.customerSnapshot },
    executive: { ...document.executiveSnapshot },
    project: {
      title: project.title || items[0]?.title || 'Proyecto',
      status: project.status,
      stage: project.current_stage,
      priority: project.priority || 'normal',
      expectedDeliveryAt: project.expected_delivery_at || '',
      images: projectImageUrl ? [projectImageUrl] : []
    },
    items,
    currency: 'USD',
    settlementCurrency: 'NIO',
    totals: {
      subtotal,
      discount,
      taxRate: asNumber(document.pricing?.taxRate),
      tax,
      total,
      exchangeRate: asNumber(document.pricing?.exchangeRate),
      exchangeRateDate: document.pricing?.exchangeRateDate || '',
      payableTotalNio: asNumber(document.pricing?.payableTotalNio, total * asNumber(document.pricing?.exchangeRate))
    },
    paymentTerms: { ...document.paymentTerms },
    source: { ...document.quotation.source },
    metadata: { generatedAt: new Date().toISOString() }
  };

  return resolveQuotationTemplate(quotationDocument);
}

class QuotationDocumentBuilder {
  build(input) {
    return buildQuotationDocument(input);
  }
}

module.exports = {
  QuotationDocumentBuilder,
  buildQuotationDocument,
  resolveIssuedAt,
  resolveValidUntil,
  resolvePrimaryImage,
  sanitizeItem
};
