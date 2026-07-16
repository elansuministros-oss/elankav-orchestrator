import { createQuoteProject, validateQuoteProject } from '../../modules/quoteCore/quoteProjectContract.js';

function mapQuotationRow(document) {
  return {
    id: document.quotation.quotationId || undefined,
    quotation_number: document.quotation.quotationNumber || null,
    platform_id: document.quotation.platformId,
    status: document.quotation.status,
    source_type: document.quotation.source.type,
    source_id: document.quotation.source.sourceId || null,
    customer_id: document.relations.customerId,
    executive_id: document.relations.executiveId,
    public_token: document.quotation.publicToken || null,
    public_url: document.quotation.publicUrl || null,
    issued_at: document.quotation.issuedAt,
    valid_until: document.quotation.validUntil || null,
    customer_snapshot: document.customerSnapshot,
    executive_snapshot: document.executiveSnapshot,
    items: document.items,
    pricing: document.pricing,
    payment_terms: document.paymentTerms,
    relations: document.relations,
    contract_version: document.contractVersion,
    created_by: document.audit.createdBy || null,
    updated_by: document.audit.updatedBy || document.audit.createdBy || null
  };
}

function mapProjectRow(document, quotationId) {
  return {
    id: document.project.projectId || undefined,
    project_number: document.project.projectNumber || null,
    quotation_id: quotationId,
    platform_id: document.quotation.platformId,
    customer_id: document.relations.customerId,
    executive_id: document.relations.executiveId,
    status: document.project.status,
    current_stage: document.project.currentStage,
    priority: document.project.priority,
    expected_delivery_at: document.project.expectedDeliveryAt || null,
    activated_at: document.project.activatedAt || null,
    completed_at: document.project.completedAt || null,
    source: document.quotation.source,
    relations: document.relations,
    updated_by: document.audit.updatedBy || document.audit.createdBy || null
  };
}

export class QuoteProjectService {
  constructor({ adapter, eventService } = {}) {
    if (!adapter) throw new Error('QuoteProjectService requiere adapter');
    this.adapter = adapter;
    this.eventService = eventService || null;
  }

  async create(input, actor = {}) {
    const document = createQuoteProject({
      ...input,
      audit: {
        ...input.audit,
        createdBy: actor.userId || input.audit?.createdBy || '',
        updatedBy: actor.userId || input.audit?.updatedBy || ''
      }
    });

    const validation = validateQuoteProject(document);
    if (!validation.ok) {
      const error = new Error(`Cotización inválida: ${validation.errors.join('; ')}`);
      error.code = 'QUOTE_VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const quotation = await this.adapter.createQuotation(mapQuotationRow(document));
    const project = await this.adapter.createProject(mapProjectRow(document, quotation.id));

    await this.adapter.upsertFollowUp({
      quotation_id: quotation.id,
      owner_executive_id: document.followUp.ownerExecutiveId,
      last_follow_up_at: document.followUp.lastFollowUpAt || null,
      next_follow_up_at: document.followUp.nextFollowUpAt || null,
      next_action: document.followUp.nextAction || null,
      notes: document.followUp.notes || null,
      updated_by: actor.userId || null
    });

    await this.recordEvent({
      quotationId: quotation.id,
      projectId: project.id,
      eventType: 'quotation.created',
      actor,
      payload: {
        source: document.quotation.source,
        totalUsd: document.pricing.totalUsd,
        payableTotalNio: document.pricing.payableTotalNio
      }
    });

    return { quotation, project, document };
  }

  async recordFollowUp({ quotationId, projectId = null, nextFollowUpAt = null, nextAction = '', notes = '', actor = {} }) {
    const followUp = await this.adapter.upsertFollowUp({
      quotation_id: quotationId,
      owner_executive_id: actor.executiveId || null,
      last_follow_up_at: new Date().toISOString(),
      next_follow_up_at: nextFollowUpAt,
      next_action: nextAction || null,
      notes: notes || null,
      updated_by: actor.userId || null
    });

    await this.recordEvent({
      quotationId,
      projectId,
      eventType: 'quotation.follow_up_recorded',
      actor,
      payload: { nextFollowUpAt, nextAction, notes }
    });

    return followUp;
  }

  async confirmDeposit({ quotationId, projectId, actor = {}, paymentReference = '' }) {
    const quotation = await this.adapter.updateQuotation(quotationId, {
      status: 'deposit_confirmed',
      deposit_confirmed_at: new Date().toISOString(),
      deposit_reference: paymentReference || null,
      updated_by: actor.userId || null
    });

    const project = await this.adapter.updateProject(projectId, {
      status: 'active',
      current_stage: 'work_order_ready',
      activated_at: new Date().toISOString(),
      updated_by: actor.userId || null
    });

    await this.recordEvent({
      quotationId,
      projectId,
      eventType: 'quotation.deposit_confirmed',
      actor,
      payload: { paymentReference }
    });

    await this.recordEvent({
      quotationId,
      projectId,
      eventType: 'project.activated',
      actor,
      payload: { currentStage: 'work_order_ready' }
    });

    return { quotation, project };
  }

  async listForActor(filters = {}, actor = {}) {
    const scopedFilters = { ...filters };
    if (actor.role === 'executive') {
      if (!actor.executiveId) throw new Error('El ejecutivo autenticado no tiene executiveId');
      scopedFilters.executiveId = actor.executiveId;
    }
    return this.adapter.listQuotations(scopedFilters);
  }

  async listProjectsForActor(filters = {}, actor = {}) {
    const scopedFilters = { ...filters };
    if (actor.role === 'executive') {
      if (!actor.executiveId) throw new Error('El ejecutivo autenticado no tiene executiveId');
      scopedFilters.executiveId = actor.executiveId;
    }
    return this.adapter.listProjects(scopedFilters);
  }

  async recordEvent({ quotationId, projectId, eventType, actor = {}, payload = {} }) {
    if (this.eventService?.createEvent) {
      return this.eventService.createEvent({ quotationId, projectId, eventType, actor, payload });
    }

    return this.adapter.appendEvent({
      quotation_id: quotationId,
      project_id: projectId || null,
      event_type: eventType,
      actor_user_id: actor.userId || null,
      actor_role: actor.role || null,
      actor_executive_id: actor.executiveId || null,
      payload
    });
  }
}

export const quoteProjectRowMappers = Object.freeze({ mapQuotationRow, mapProjectRow });
