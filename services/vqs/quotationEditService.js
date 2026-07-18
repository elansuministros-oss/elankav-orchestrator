'use strict';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mapQuotationPatch(document, current = {}, actor = {}) {
  return {
    platform_id: document.quotation.platformId,
    status: current.status || document.quotation.status,
    source_type: document.quotation.source.type,
    source_id: document.quotation.source.sourceId || null,
    design_mode: document.quotation.source.designMode,
    customer_id: document.relations.customerId,
    executive_id: document.relations.executiveId,
    public_token: current.public_token || document.quotation.publicToken || null,
    public_url: current.public_url || document.quotation.publicUrl || null,
    issued_at: current.issued_at || document.quotation.issuedAt,
    valid_until: document.quotation.validUntil || current.valid_until || null,
    customer_snapshot: document.customerSnapshot,
    executive_snapshot: document.executiveSnapshot,
    items: document.items,
    pricing: document.pricing,
    payment_terms: document.paymentTerms,
    relations: {
      ...asObject(current.relations),
      ...document.relations
    },
    contract_version: document.contractVersion,
    subtotal_usd: document.pricing.subtotalUsd,
    discount_usd: document.pricing.discountUsd,
    tax_usd: document.pricing.taxUsd,
    total_usd: document.pricing.totalUsd,
    exchange_rate: document.pricing.exchangeRate,
    payable_total_nio: document.pricing.payableTotalNio,
    updated_by: actor.userId || current.updated_by || null
  };
}

function mapProjectPatch(document, current = {}, actor = {}) {
  return {
    platform_id: document.quotation.platformId,
    customer_id: document.relations.customerId,
    executive_id: document.relations.executiveId,
    title: document.project.title,
    customer_snapshot: document.customerSnapshot,
    priority: document.project.priority,
    expected_delivery_at: document.project.expectedDeliveryAt || null,
    source: document.quotation.source,
    relations: {
      ...asObject(current.relations),
      ...document.relations
    },
    updated_by: actor.userId || current.updated_by || null
  };
}

class QuotationEditService {
  constructor({ adapter, documentBuilder, documentDeliveryService = null } = {}) {
    if (!adapter) throw new Error('QuotationEditService requiere adapter');
    if (!documentBuilder || typeof documentBuilder.build !== 'function') {
      throw new Error('QuotationEditService requiere documentBuilder.build()');
    }
    if (documentDeliveryService && typeof documentDeliveryService.deliver !== 'function') {
      throw new Error('documentDeliveryService debe implementar deliver()');
    }
    this.adapter = adapter;
    this.documentBuilder = documentBuilder;
    this.documentDeliveryService = documentDeliveryService;
  }

  async update(projectId, input, actor = {}) {
    const project = await this.adapter.getProjectById(projectId);
    if (!project) return null;

    const quotation = await this.adapter.getQuotationById(project.quotation_id);
    if (!quotation) return null;

    if (quotation.status !== 'draft') {
      const error = new Error('Solo las cotizaciones en borrador pueden editarse');
      error.code = 'QUOTATION_EDIT_NOT_ALLOWED';
      error.details = { status: quotation.status };
      throw error;
    }

    const { createQuoteProject, validateQuoteProject } = await import('../../modules/quoteCore/quoteProjectContract.js');
    const document = createQuoteProject({
      ...input,
      quotation: {
        ...asObject(input.quotation),
        quotationId: quotation.id,
        quotationNumber: quotation.quotation_number,
        platformId: input.quotation?.platformId || quotation.platform_id,
        status: quotation.status,
        publicToken: quotation.public_token || '',
        publicUrl: quotation.public_url || '',
        issuedAt: quotation.issued_at,
        validUntil: input.quotation?.validUntil || quotation.valid_until || '',
        source: input.quotation?.source || project.source || {}
      },
      project: {
        ...asObject(input.project),
        projectId: project.id,
        projectNumber: project.project_number || '',
        status: project.status,
        currentStage: project.current_stage,
        activatedAt: project.activated_at || '',
        completedAt: project.completed_at || ''
      },
      relations: {
        ...asObject(quotation.relations),
        ...asObject(project.relations),
        ...asObject(input.relations)
      },
      audit: {
        createdAt: quotation.created_at,
        createdBy: quotation.created_by || '',
        updatedBy: actor.userId || ''
      }
    });

    const validation = validateQuoteProject(document);
    if (!validation.ok) {
      const error = new Error(`Cotización inválida: ${validation.errors.join('; ')}`);
      error.code = 'QUOTE_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const updatedQuotation = await this.adapter.updateQuotation(
      quotation.id,
      mapQuotationPatch(document, quotation, actor)
    );
    const updatedProject = await this.adapter.updateProject(
      project.id,
      mapProjectPatch(document, project, actor)
    );

    const result = {
      quotation: updatedQuotation,
      project: updatedProject,
      document
    };
    const quotationDocument = this.documentBuilder.build(result);
    const documentDelivery = this.documentDeliveryService
      ? await this.documentDeliveryService.deliver({
          quotationDocument,
          quotation: updatedQuotation,
          project: updatedProject
        })
      : null;

    return {
      ...result,
      quotationDocument,
      documentDelivery
    };
  }
}

module.exports = {
  QuotationEditService,
  mapQuotationPatch,
  mapProjectPatch
};
