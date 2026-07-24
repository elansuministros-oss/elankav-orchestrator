'use strict';

const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');
const { SupabaseStorageAdapter } = require('../adapters/storage/supabaseStorageAdapter');
const { refreshPublicQuotationDelivery } = require('../services/vqs/publicQuotationDeliveryService');

const PUBLIC_ROUTE = /^\/api\/vqs\/public\/quotations\/([^/?#]+)$/;
const UNAVAILABLE_STATUSES = new Set(['cancelled', 'expired', 'void']);
const PUBLIC_IMAGE_SIGN_TTL_SECONDS = 3600;
let adapterPromise = null;
let queryServiceModulePromise = null;

function pathnameOf(url = '') {
  try { return new URL(url, 'http://localhost').pathname; }
  catch { return ''; }
}

function matchPublicQuotationRoute(url = '') {
  const match = pathnameOf(url).match(PUBLIC_ROUTE);
  return match ? { projectId: decodeURIComponent(match[1]) } : null;
}

async function getAdapter() {
  if (!adapterPromise) {
    adapterPromise = import('../adapters/quoteCore/supabaseQuoteProjectAdapter.js')
      .then(({ SupabaseQuoteProjectAdapter }) => new SupabaseQuoteProjectAdapter({ supabase: getSupabaseClient() }));
  }
  return adapterPromise;
}

async function createQueryService(adapter) {
  if (!queryServiceModulePromise) {
    queryServiceModulePromise = import('../services/quoteCore/projectQueryService.js');
  }
  const { ProjectQueryService } = await queryServiceModulePromise;
  return new ProjectQueryService({ adapter });
}

function resetVqsPublicQuotationApiForTests() {
  adapterPromise = null;
  queryServiceModulePromise = null;
}

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

function decodeStoragePath(value = '') {
  return String(value || '')
    .split('/')
    .map((segment) => {
      try { return decodeURIComponent(segment); }
      catch { return segment; }
    })
    .join('/');
}

function resolveStorageObjectReference(asset) {
  const source = safeObject(asset);
  const explicitBucket = firstText(source.bucket, source.bucketId, source.storageBucket, source.storage_bucket);
  const explicitPath = firstText(source.objectPath, source.object_path, source.storagePath, source.storage_path, source.path);
  if (explicitBucket && explicitPath) {
    return { bucket: explicitBucket, path: explicitPath.replace(/^\/+/, '') };
  }

  const candidate = typeof asset === 'string'
    ? asset
    : firstText(source.signedUrl, source.signed_url, source.url, source.src, source.imageUrl, source.publicUrl, source.downloadUrl);
  if (!candidate) return null;

  try {
    const url = new URL(candidate, 'http://localhost');
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
      bucket: decodeStoragePath(match[1]),
      path: decodeStoragePath(match[2]).replace(/^\/+/, '')
    };
  } catch {
    return null;
  }
}

async function refreshPublicImageUrl(asset, storageClient) {
  const directUrl = typeof asset === 'string'
    ? asset.trim()
    : firstText(asset?.url, asset?.src, asset?.imageUrl, asset?.signedUrl);

  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(directUrl)) {
    return directUrl;
  }

  const reference = resolveStorageObjectReference(asset);
  if (!reference) return directUrl;

  const result = await storageClient
    .from(reference.bucket)
    .createSignedUrl(reference.path, PUBLIC_IMAGE_SIGN_TTL_SECONDS);

  if (result?.error || !result?.data?.signedUrl) {
    const error = new Error('No fue posible renovar la imagen publica de la cotizacion');
    error.code = 'PUBLIC_QUOTATION_IMAGE_SIGN_FAILED';
    error.details = { bucket: reference.bucket, path: reference.path };
    throw error;
  }

  return result.data.signedUrl;
}

function collectItemImageCandidates(item = {}) {
  const source = safeObject(item);
  const directCandidates = [source.imageUrl, source.image_url];
  const assetCandidates = [];
  const arrayFields = [
    'images',
    'imagenes',
    'renders',
    'manualImages',
    'manual_images',
    'resultFiles',
    'result_files',
    'assetFiles',
    'asset_files'
  ];

  for (const field of arrayFields) {
    const value = source[field];
    if (Array.isArray(value)) assetCandidates.push(...value);
    else if (value) assetCandidates.push(value);
  }

  return [...assetCandidates, ...directCandidates].filter(Boolean);
}

function imageCandidateKey(candidate) {
  const reference = resolveStorageObjectReference(candidate);
  if (reference) return `${reference.bucket}/${reference.path}`;
  if (typeof candidate === 'string') return candidate.trim();
  return firstText(candidate?.url, candidate?.src, candidate?.imageUrl, candidate?.signedUrl, candidate?.publicUrl, candidate?.downloadUrl);
}

async function refreshImageCandidates(candidates, storageClient) {
  const refreshed = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const key = imageCandidateKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    try {
      const url = await refreshPublicImageUrl(candidate, storageClient);
      if (url) refreshed.push(url);
    } catch (error) {
      if (error?.code !== 'PUBLIC_QUOTATION_IMAGE_SIGN_FAILED') throw error;
      console.error('[VQS_PUBLIC_QUOTATION_IMAGE_SKIPPED]', error.details || {});
    }
  }

  return refreshed;
}

async function refreshPublicQuotationImages(quotation = {}, storageClient) {
  const document = safeObject(quotation.quotation_document || quotation.quotationDocument);
  const publicDocument = safeObject(document.publicDocument || document.public_document);
  if (!Object.keys(publicDocument).length) return quotation;

  const nextPublicDocument = { ...publicDocument };
  const items = Array.isArray(publicDocument.items) ? publicDocument.items : [];
  nextPublicDocument.items = await Promise.all(items.map(async (item) => {
    const nextItem = { ...safeObject(item) };
    const refreshedImages = await refreshImageCandidates(collectItemImageCandidates(nextItem), storageClient);
    if (!refreshedImages.length) return nextItem;
    nextItem.imageUrl = refreshedImages[0];
    nextItem.images = refreshedImages;
    return nextItem;
  }));

  const project = safeObject(publicDocument.project);
  const projectImages = Array.isArray(project.images) ? project.images : [];
  if (projectImages.length) {
    const refreshedProjectImages = await refreshImageCandidates(projectImages, storageClient);
    nextPublicDocument.project = {
      ...project,
      images: refreshedProjectImages
    };
  }

  return {
    ...quotation,
    quotation_document: {
      ...document,
      publicDocument: nextPublicDocument
    }
  };
}

function resolveDocument(quotation = {}) {
  const document = safeObject(quotation.quotation_document || quotation.quotationDocument);
  const publicDocument = safeObject(document.publicDocument || document.public_document);
  return Object.keys(publicDocument).length ? { ...document, publicDocument } : null;
}

function resolvePdfUrl(quotation = {}, document = {}) {
  const publicDocument = safeObject(document.publicDocument);
  const candidates = [
    quotation.pdf_url,
    quotation.document_url,
    quotation.public_url,
    document.pdfUrl,
    document.pdf_url,
    publicDocument.pdfUrl,
    publicDocument.pdf_url,
    publicDocument.documentUrl,
    publicDocument.document_url
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
    } catch {}
  }

  return '';
}

function sanitizePublicQuotation({ project = {}, quotation = {} } = {}) {
  const document = resolveDocument(quotation);
  if (!document) {
    const error = new Error('Documento publico no disponible');
    error.code = 'PUBLIC_QUOTATION_DOCUMENT_MISSING';
    throw error;
  }

  const publicDocument = safeObject(document.publicDocument);
  return Object.freeze({
    projectId: project.id,
    projectNumber: project.project_number || '',
    quotationId: quotation.id,
    quotationNumber: quotation.quotation_number || publicDocument.quotationNumber || '',
    platformId: quotation.platform_id || project.platform_id || '',
    status: quotation.status || project.status || '',
    issuedAt: quotation.issued_at || publicDocument.issuedAt || null,
    validUntil: quotation.valid_until || publicDocument.validUntil || null,
    pdfUrl: resolvePdfUrl(quotation, document),
    quotation_document: {
      contractVersion: document.contractVersion || document.contract_version || '',
      publicDocument
    }
  });
}

async function refreshPublicPdfUrl({
  publicQuotation,
  quotation,
  storageAdapter
} = {}) {
  const fallbackPdfUrl = String(publicQuotation?.pdfUrl || '').trim();

  try {
    const delivery = await refreshPublicQuotationDelivery({
      quotation,
      storageAdapter
    });

    return delivery?.signedUrl
      ? { ...publicQuotation, pdfUrl: delivery.signedUrl }
      : publicQuotation;
  } catch (error) {
    console.error('[VQS_PUBLIC_QUOTATION_PDF_SIGN_SKIPPED]', {
      errorCode: error?.code || 'PUBLIC_QUOTATION_PDF_SIGN_FAILED'
    });

    return {
      ...publicQuotation,
      pdfUrl: fallbackPdfUrl
    };
  }
}

async function handleVqsPublicQuotationApi({
  req,
  res,
  sendJson,
  adapter,
  storageClient,
  storageAdapter
} = {}) {
  const route = matchPublicQuotationRoute(req?.url);
  if (!route) return false;

  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    sendJson(res, 405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Metodo no permitido' });
    return true;
  }

  try {
    const repository = adapter || await getAdapter();
    const queryService = await createQueryService(repository);
    const quotation = await queryService.getQuotationDetailByReference(route.projectId, { platformId: 'ELANVISUAL' });
    if (!quotation) {
      sendJson(res, 404, { success: false, code: 'PUBLIC_QUOTATION_NOT_FOUND', error: 'Cotizacion no encontrada' });
      return true;
    }

    const status = String(quotation.status || '').toLowerCase();
    const validUntil = quotation.validUntil ? new Date(quotation.validUntil) : null;
    const expiredByDate = validUntil && !Number.isNaN(validUntil.getTime()) && validUntil.getTime() < Date.now();
    if (UNAVAILABLE_STATUSES.has(status) || expiredByDate) {
      sendJson(res, 410, { success: false, code: 'PUBLIC_QUOTATION_UNAVAILABLE', error: 'Cotizacion no disponible' });
      return true;
    }

    const storage = storageClient || getSupabaseClient().storage;
    const withImages = await refreshPublicQuotationImages(quotation, storage);
    const storedQuotation = quotation.quotationId && typeof repository.getQuotationById === 'function'
      ? await repository.getQuotationById(quotation.quotationId)
      : null;
    const documentStorageAdapter = storageAdapter || new SupabaseStorageAdapter();
    const publicQuotation = await refreshPublicPdfUrl({
      publicQuotation: withImages,
      quotation: storedQuotation || quotation,
      storageAdapter: documentStorageAdapter
    });

    sendJson(res, 200, { success: true, data: publicQuotation });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError || error?.code === 'SUPABASE_CONFIGURATION_ERROR') {
      sendJson(res, 503, { success: false, code: 'PUBLIC_QUOTATION_UNAVAILABLE', error: 'Servicio temporalmente no disponible' });
    } else if (error?.code === 'PUBLIC_QUOTATION_DOCUMENT_MISSING') {
      sendJson(res, 410, { success: false, code: error.code, error: 'Cotizacion no disponible' });
    } else if (error?.code === 'PUBLIC_QUOTATION_IMAGE_SIGN_FAILED') {
      console.error('[VQS_PUBLIC_QUOTATION_IMAGE_SIGN_FAILED]', error.details || {});
      sendJson(res, 503, { success: false, code: error.code, error: 'Imagenes temporalmente no disponibles' });
    } else {
      console.error('[VQS_PUBLIC_QUOTATION_ERROR]', {
        errorCode: error?.code || error?.cause?.code || 'UNKNOWN',
        errorMessage: error?.message || error?.cause?.message || 'UNKNOWN',
        stack: error?.stack || ''
      });
      sendJson(res, 500, { success: false, code: 'PUBLIC_QUOTATION_ERROR', error: 'No fue posible consultar la cotizacion' });
    }
  }
  return true;
}

module.exports = {
  handleVqsPublicQuotationApi,
  matchPublicQuotationRoute,
  resetVqsPublicQuotationApiForTests,
  sanitizePublicQuotation,
  resolveStorageObjectReference,
  refreshPublicImageUrl,
  refreshPublicQuotationImages,
  refreshPublicPdfUrl,
  PUBLIC_IMAGE_SIGN_TTL_SECONDS
};
