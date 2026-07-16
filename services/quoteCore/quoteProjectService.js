import { createQuoteProject, validateQuoteProject, PROJECT_STATUSES } from '../../modules/quoteCore/quoteProjectContract.js';

const PROJECT_STAGES = new Set(['quotation', 'design', 'work_order_ready', 'production', 'installation', 'delivery', 'completed']);
const PROJECT_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function mapQuotationRow(document) {
  return {
    id: document.quotation.quotationId || undefined,
    quotation_number: document.quotation.quotationNumber || null,
    platform_id: document.quotation.platformId,
    status: document.quotation.status,
    source_type: document.quotation.source.type,
    source_id: document.quotation.source.sourceId || null,
    design_mode: document.quotation.source.designMode,
    customer_id: document.relations.customerId,
    executive_id: document.relations.executiveId,
    public_token: document.quotation.publicToken || undefined,
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
    subtotal_usd: document.pricing.subtotalUsd,
    discount_usd: document.pricing.discountUsd,
    tax_usd: document.pricing.taxUsd,
    total_usd: document.pricing.totalUsd,
    exchange_rate: document.pricing.exchangeRate,
    payable_total_nio: document.pricing.payableTotalNio,
    created_by: document.audit.createdBy || null,
    updated_by: document.audit.updatedBy || document.audit.createdBy || null
  };
}

function mapProjectRow(document, quotationId) {
  const firstItem = document.items?.[0];
  return {
    id: document.project.projectId || undefined,
    project_number: document.project.projectNumber || null,
    quotation_id: quotationId,
    platform_id: document.quotation.platformId,
    customer_id: document.relations.customerId,
    executive_id: document.relations.executiveId,
    title: firstItem?.title || 'Proyecto',
    customer_snapshot: document.customerSnapshot,
    status: document.project.status,
    current_stage: document.project.currentStage,
    priority: document.project.priority,
    expected_delivery_at: document.project.expectedDeliveryAt || null,
    activated_at: document.project.activatedAt || null,
    completed_at: document.project.completedAt || null,
    source: document.quotation.source,
    relations: document.relations,
    created_by: document.audit.createdBy || null,
    updated_by: document.audit.updatedBy || document.audit.createdBy || null
  };
}

function buildProjectPatch(input = {}, actor = {}) {
  const patch = {};
  const errors = [];

  if (Object.hasOwn(input, 'title')) {
    const title = String(input.title || '').trim();
    if (!title) errors.push('title no puede estar vacío');
    else patch.title = title;
  }
  if (Object.hasOwn(input, 'priority')) {
    if (!PROJECT_PRIORITIES.has(input.priority)) errors.push('priority no es válido');
    else patch.priority = input.priority;
  }
  if (Object.hasOwn(input, 'status')) {
    if (!PROJECT_STATUSES.includes(input.status)) errors.push('status no es válido');
    else patch.status = input.status;
  }
  if (Object.hasOwn(input, 'currentStage')) {
    if (!PROJECT_STAGES.has(input.currentStage)) errors.push('currentStage no es válido');
    else patch.current_stage = input.currentStage;
  }
  if (Object.hasOwn(input, 'expectedDeliveryAt')) {
    if (input.expectedDeliveryAt === null || input.expectedDeliveryAt === '') {
      patch.expected_delivery_at = null;
    } else {
      const date = new Date(input.expectedDeliveryAt);
      if (Number.isNaN(date.getTime())) errors.push('expectedDeliveryAt no es válido');
      else patch.expected_delivery_at = date.toISOString();
    }
  }
  if (!Object.keys(patch).length && !errors.length) errors.push('No hay campos permitidos para actualizar');
  if (errors.length) {
    const error = new Error(`Actualización inválida: ${errors.join('; ')}`);
    error.code = 'PROJECT_UPDATE_VALIDATION_ERROR';
    error.details = errors;
    throw error;
  }
  patch.updated_by = actor.userId || null;
  return patch;
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
      owner_executive_id: document.followUp.ownerExecutiveId || null,
      last_follow_up_at: document.followUp.lastFollowUpAt || null,
      next_follow_up_at: document.followUp.nextFollowUpAt || null,
      next_action: document.followUp.nextAction || null,
      notes: document.followUp.notes || null,
      created_by: actor.userId || null,
      updated_by: actor.userId || null,
      updated_at: new Date().toISOString()
    });
    await this.recordEvent({
      quotationId: quotation.id,
      projectId: project.id,
      eventType: 'quotation.created',
      platformId: document.quotation.platformId,
      actor,
      payload: { source: document.quotation.source, totalUsd: document.pricing.totalUsd, payableTotalNio: document.pricing.payableTotalNio }
    });
    return { quotation, project, document };
  }

  async updateProject(projectId, input = {}, actor = {}) {
    const current = await this.adapter.getProjectById(projectId);
    if (!current) return null;
    const patch = buildProjectPatch(input, actor);
    const updated = await this.adapter.updateProject(projectId, patch);
    const stageChanged = patch.current_stage && patch.current_stage !== current.current_stage;
    if (stageChanged) {
      await this.recordEvent({
        quotationId: current.quotation_id,
        projectId,
        eventType: 'project.stage_changed',
        platformId: current.platform_id || actor.platformId || null,
        actor,
        payload: { from: current.current_stage, to: patch.current_stage }
      });
    }
    return updated;
  }

  async recordFollowUp({ quotationId, projectId = null, nextFollowUpAt = null, nextAction = '', notes = '', actor = {} }) {
    const now = new Date().toISOString();
    const followUp = await this.adapter.upsertFollowUp({
      quotation_id: quotationId,
      owner_executive_id: actor.executiveId || null,
      last_follow_up_at: now,
      next_follow_up_at: nextFollowUpAt,
      next_action: nextAction || null,
      notes: notes || null,
      updated_by: actor.userId || null,
      updated_at: now
    });
    await this.recordEvent({ quotationId, projectId, eventType: 'quotation.follow_up_recorded', platformId: actor.platformId || null, actor, payload: { nextFollowUpAt, nextAction, notes } });
    return followUp;
  }

  async confirmDeposit({ quotationId, projectId, actor = {}, paymentReference = '' }) {
    const now = new Date().toISOString();
    const quotation = await this.adapter.updateQuotation(quotationId, {
      status: 'deposit_confirmed',
      deposit_confirmed_at: now,
      deposit_reference: paymentReference || null,
      updated_by: actor.userId || null
    });
    const project = await this.adapter.updateProject(projectId, {
      status: 'active',
      current_stage: 'work_order_ready',
      activated_at: now,
      updated_by: actor.userId || null
    });
    const platformId = quotation.platform_id || project.platform_id || actor.platformId || null;
    await this.recordEvent({ quotationId, projectId, eventType: 'quotation.deposit_confirmed', platformId, actor, payload: { paymentReference } });
    await this.recordEvent({ quotationId, projectId, eventType: 'project.activated', platformId, actor, payload: { currentStage: 'work_order_ready' } });
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

  async recordEvent({ quotationId, projectId, eventType, platformId = null, actor = {}, payload = {} }) {
    if (this.eventService?.createEvent) {
      return this.eventService.createEvent({ quotationId, projectId, eventType, platformId, actor, payload });
    }
    return this.adapter.appendEvent({
      quotation_id: quotationId,
      project_id: projectId || null,
      event_type: eventType,
      actor_type: actor.type || 'user',
      actor_user_id: actor.userId || null,
      actor_role: actor.role || null,
      actor_executive_id: actor.executiveId || null,
      platform_id: platformId,
      payload
    });
  }
}

export const quoteProjectRowMappers = Object.freeze({ mapQuotationRow, mapProjectRow });
export const quoteProjectUpdateHelpers = Object.freeze({ buildProjectPatch });
