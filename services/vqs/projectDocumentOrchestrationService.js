'use strict';

const { SupabaseStorageAdapter } = require('../../adapters/storage/supabaseStorageAdapter');
const { QuotationPdfRenderer } = require('./quotationPdfRenderer');
const { QuotationDocumentDeliveryService } = require('./quotationDocumentDeliveryService');
const { QuotationAssetPersistenceService } = require('./quotationAssetPersistenceService');

function deliveryEnabled(env = process.env) {
  return String(env.VQS_DOCUMENT_DELIVERY_ENABLED || '').trim().toLowerCase() === 'true';
}

function createDefaultDeliveryService(projectService, env = process.env) {
  if (!deliveryEnabled(env)) return null;
  if (!projectService?.adapter) {
    throw new Error('No se puede habilitar Document Delivery sin adapter de cotizaciones');
  }

  return new QuotationDocumentDeliveryService({
    storageAdapter: new SupabaseStorageAdapter(),
    pdfRenderer: new QuotationPdfRenderer(),
    quotationRepository: projectService.adapter,
    bucket: env.VQS_DOCUMENT_BUCKET || 'official-documents',
    expiresIn: Number(env.VQS_DOCUMENT_DELIVERY_TTL_SECONDS || 3600)
  });
}

class ProjectDocumentOrchestrationService {
  constructor({ projectService, documentBuilder, documentDeliveryService, assetPersistenceService, env = process.env } = {}) {
    if (!projectService) throw new Error('ProjectDocumentOrchestrationService requiere projectService');
    if (!documentBuilder) throw new Error('ProjectDocumentOrchestrationService requiere documentBuilder');

    const resolvedDeliveryService = documentDeliveryService === undefined
      ? createDefaultDeliveryService(projectService, env)
      : documentDeliveryService;

    if (resolvedDeliveryService && typeof resolvedDeliveryService.deliver !== 'function') {
      throw new Error('documentDeliveryService debe implementar deliver()');
    }

    this.projectService = projectService;
    this.documentBuilder = documentBuilder;
    this.documentDeliveryService = resolvedDeliveryService;
    this.assetPersistenceService = assetPersistenceService || new QuotationAssetPersistenceService({
      bucket: env.VQS_DOCUMENT_BUCKET || 'official-documents',
      expiresIn: Number(env.VQS_DOCUMENT_DELIVERY_TTL_SECONDS || 3600)
    });
  }

  async create(input, actor = {}) {
    const persistedInput = await this.assetPersistenceService.persistInput(input);
    const result = await this.projectService.create(persistedInput, actor);
    const quotationDocument = this.documentBuilder.build(result);
    const documentDelivery = this.documentDeliveryService
      ? await this.documentDeliveryService.deliver({
          quotationDocument,
          quotation: result.quotation,
          project: result.project
        })
      : null;

    return { ...result, quotationDocument, documentDelivery };
  }

  async updateProject(projectId, patch, actor = {}) {
    return this.projectService.updateProject(projectId, patch, actor);
  }
}

module.exports = {
  ProjectDocumentOrchestrationService,
  createDefaultDeliveryService,
  deliveryEnabled
};
