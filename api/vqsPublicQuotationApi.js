'use strict';

const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');

const PUBLIC_ROUTE = /^\/api\/vqs\/public\/quotations\/([^/?#]+)$/;
const UNAVAILABLE_STATUSES = new Set(['cancelled', 'expired', 'void']);
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

async function handleVqsPublicQuotationApi({ req, res, sendJson, adapter } = {}) {
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

    sendJson(res, 200, { success: true, data: quotation });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError || error?.code === 'SUPABASE_CONFIGURATION_ERROR') {
      sendJson(res, 503, { success: false, code: 'PUBLIC_QUOTATION_UNAVAILABLE', error: 'Servicio temporalmente no disponible' });
    } else if (error?.code === 'PUBLIC_QUOTATION_DOCUMENT_MISSING') {
      sendJson(res, 410, { success: false, code: error.code, error: 'Cotizacion no disponible' });
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
  sanitizePublicQuotation
};
