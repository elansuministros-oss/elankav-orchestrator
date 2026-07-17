'use strict';

const { assertStorageAdapter } = require('../../adapters/storage/storageAdapterContract');

const DEFAULT_BUCKET = 'official-documents';
const DEFAULT_EXPIRES_IN = 3600;

function required(value, field) {
  const text = String(value || '').trim();
  if (!text) {
    const error = new Error(`${field} es obligatorio`);
    error.code = 'VQS_DOCUMENT_DELIVERY_INVALID';
    error.details = { field };
    throw error;
  }
  return text;
}

function safeSegment(value, fallback) {
  return String(value || fallback || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function buildObjectPath({ quotationDocument = {}, quotation = {} } = {}) {
  const publicDocument = quotationDocument.publicDocument || quotationDocument.public_document || {};
  const platformId = safeSegment(
    quotationDocument.platformId || publicDocument.platformId || quotation.platform_id,
    'UNKNOWN'
  ).toUpperCase();
  const quotationId = safeSegment(quotation.id || publicDocument.quotationId, 'quotation');
  const quotationNumber = safeSegment(
    quotation.quotation_number || quotationDocument.quotationNumber || publicDocument.quotationNumber,
    quotationId
  );

  return `${platformId}/quotations/${quotationId}/${quotationNumber}.pdf`;
}

class QuotationDocumentDeliveryService {
  constructor({
    storageAdapter,
    pdfRenderer,
    quotationRepository,
    bucket = DEFAULT_BUCKET,
    expiresIn = DEFAULT_EXPIRES_IN,
    now = () => new Date()
  } = {}) {
    this.storageAdapter = assertStorageAdapter(storageAdapter);
    if (!pdfRenderer || typeof pdfRenderer.render !== 'function') {
      throw new Error('QuotationDocumentDeliveryService requiere pdfRenderer.render()');
    }
    if (!quotationRepository || typeof quotationRepository.updateQuotation !== 'function') {
      throw new Error('QuotationDocumentDeliveryService requiere quotationRepository.updateQuotation()');
    }
    this.pdfRenderer = pdfRenderer;
    this.quotationRepository = quotationRepository;
    this.bucket = required(bucket, 'bucket');
    this.expiresIn = Number(expiresIn);
    this.now = now;
  }

  async deliver({ quotationDocument, quotation, project } = {}) {
    const quotationId = required(quotation?.id, 'quotation.id');
    const path = buildObjectPath({ quotationDocument, quotation });
    const body = await this.pdfRenderer.render(quotationDocument);

    if (!Buffer.isBuffer(body) || body.length === 0) {
      const error = new Error('El renderer no devolvió un PDF válido');
      error.code = 'VQS_PDF_RENDER_INVALID';
      throw error;
    }

    const generatedAt = this.now().toISOString();
    const upload = await this.storageAdapter.uploadObject({
      bucket: this.bucket,
      path,
      body,
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: true,
      metadata: {
        documentType: 'quotation',
        quotationId,
        quotationNumber: quotation.quotation_number || quotationDocument?.quotationNumber || '',
        projectId: project?.id || quotationDocument?.publicDocument?.projectId || '',
        platformId: quotationDocument?.platformId || quotation?.platform_id || '',
        schemaVersion: quotationDocument?.schemaVersion || '1.0.0',
        generatedAt
      }
    });

    const persisted = {
      bucket: upload.bucket,
      path: upload.path,
      contentType: 'application/pdf',
      generatedAt,
      templateId: quotationDocument?.template?.templateId || '',
      templateVersion: quotationDocument?.template?.templateVersion || '',
      schemaVersion: quotationDocument?.schemaVersion || '1.0.0'
    };

    try {
      await this.quotationRepository.updateQuotation(quotationId, {
        relations: {
          ...(quotation.relations || {}),
          documentDelivery: persisted
        }
      });
    } catch (error) {
      try {
        await this.storageAdapter.deleteObject({
          bucket: upload.bucket,
          path: upload.path,
          hardDelete: true,
          reason: 'Quotation persistence failed after upload',
          context: 'rollback_unpersisted_upload'
        });
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
      }
      throw error;
    }

    const delivery = await this.storageAdapter.createDelivery({
      bucket: upload.bucket,
      path: upload.path,
      expiresIn: this.expiresIn
    });

    return {
      ...persisted,
      signedUrl: delivery.signedUrl,
      expiresIn: delivery.expiresIn
    };
  }
}

module.exports = {
  QuotationDocumentDeliveryService,
  buildObjectPath,
  DEFAULT_BUCKET,
  DEFAULT_EXPIRES_IN
};
