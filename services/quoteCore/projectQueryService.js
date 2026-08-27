import quotationDocumentBuilderModule from '../vqs/quotationDocumentBuilder.js';

const { buildQuotationDocument } = quotationDocumentBuilderModule;

const ACTIVE_QUOTATION_STATUSES = new Set([
  'draft',
  'quoted',
  'sent',
  'viewed',
  'approved',
  'awaiting_deposit'
]);

const ACTIVE_PROJECT_STATUSES = new Set([
  'active',
  'design',
  'work_order_ready',
  'production',
  'installation'
]);

const normalizeText = (value = '') => String(value).trim().toLocaleLowerCase('es');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysBetween = (from, to) => Math.floor((to.getTime() - from.getTime()) / 86400000);

function matchesCustomer(row, customerQuery) {
  const needle = normalizeText(customerQuery);
  if (!needle) return true;

  return [
    row.customer_name,
    row.customer_company_name,
    row.customer_snapshot?.name,
    row.customer_snapshot?.companyName,
    row.customer_id
  ].some((value) => normalizeText(value).includes(needle));
}

function publicProject(row) {
  return {
    projectId: row.id,
    projectNumber: row.project_number,
    quotationId: row.quotation_id,
    platformId: row.platform_id,
    customerId: row.customer_id,
    executiveId: row.executive_id,
    title: row.title || row.project_title || '',
    status: row.status,
    currentStage: row.current_stage,
    priority: row.priority,
    expectedDeliveryAt: row.expected_delivery_at,
    activatedAt: row.activated_at,
    completedAt: row.completed_at,
    customerName: row.customer_name || row.customer_snapshot?.name || '',
    customerCompanyName: row.customer_company_name || row.customer_snapshot?.companyName || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicProjectStatus(row) {
  return {
    projectId: row.id,
    projectNumber: row.project_number,
    status: row.status,
    stage: row.current_stage,
    priority: row.priority,
    expectedDeliveryAt: row.expected_delivery_at,
    activatedAt: row.activated_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

function publicQuotation(row, project = {}) {
  const projectId = firstText(project.id, row.project_id);
  return {
    id: projectId,
    projectId,
    projectNumber: firstText(project.project_number, row.project_number),
    quotationId: row.id,
    quotationNumber: row.quotation_number,
    customerId: row.customer_id,
    executiveId: row.executive_id,
    platformId: firstText(row.platform_id, project.platform_id),
    status: row.status,
    issuedAt: row.issued_at,
    validUntil: row.valid_until,
    totalUsd: row.total_usd,
    payableTotalNio: row.payable_total_nio,
    customerName: row.customer_name || row.customer_snapshot?.name || '',
    customerCompanyName: row.customer_company_name || row.customer_snapshot?.companyName || ''
  };
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function numberOrFallback(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePlatformId(value = '') {
  return String(value || '').trim().toUpperCase();
}

function samePlatform({ quotation = {}, project = {}, platformId = '' } = {}) {
  const expected = normalizePlatformId(platformId);
  if (!expected) return true;
  return [quotation.platform_id, project.platform_id]
    .map(normalizePlatformId)
    .some((value) => value === expected);
}

function isInvalidUuidError(error) {
  const code = error?.cause?.code || error?.code;
  const message = String(error?.cause?.message || error?.message || '');
  return code === '22P02' || message.includes('invalid input syntax for type uuid');
}

function resolveStoredPricing(quotation = {}) {
  const pricing = { ...safeObject(quotation.pricing) };
  if (pricing.subtotalUsd === undefined) pricing.subtotalUsd = numberOrFallback(quotation.subtotal_usd);
  if (pricing.discountUsd === undefined) pricing.discountUsd = numberOrFallback(quotation.discount_usd);
  if (pricing.taxUsd === undefined) pricing.taxUsd = numberOrFallback(quotation.tax_usd);
  if (pricing.totalUsd === undefined) pricing.totalUsd = numberOrFallback(quotation.total_usd);
  if (pricing.exchangeRate === undefined) pricing.exchangeRate = numberOrFallback(quotation.exchange_rate);
  if (pricing.payableTotalNio === undefined) pricing.payableTotalNio = numberOrFallback(quotation.payable_total_nio);
  return pricing;
}

function buildStoredDocument({ quotation = {}, project = {} } = {}) {
  const executiveSnapshot = safeObject(quotation.executive_snapshot);
  const relations = {
    ...safeObject(quotation.relations),
    customerId: firstText(quotation.customer_id, project.customer_id, quotation.relations?.customerId),
    executiveId: firstText(quotation.executive_id, project.executive_id, quotation.relations?.executiveId)
  };

  return {
    contractVersion: quotation.contract_version || '1.0.0',
    quotation: {
      quotationId: quotation.id,
      quotationNumber: quotation.quotation_number,
      platformId: firstText(quotation.platform_id, project.platform_id),
      status: quotation.status || 'draft',
      issuedAt: quotation.issued_at || quotation.created_at || '',
      validUntil: quotation.valid_until || '',
      source: {
        type: quotation.source_type || 'manual',
        sourceId: quotation.source_id || '',
        designMode: quotation.design_mode || 'optional'
      }
    },
    project: {
      projectId: project.id,
      projectNumber: project.project_number || '',
      status: project.status || 'pending_activation',
      currentStage: project.current_stage || 'quotation',
      priority: project.priority || 'normal',
      expectedDeliveryAt: project.expected_delivery_at || '',
      images: safeArray(project.images)
    },
    relations,
    customerSnapshot: safeObject(quotation.customer_snapshot),
    executiveSnapshot: {
      ...executiveSnapshot,
      executiveId: firstText(executiveSnapshot.executiveId, executiveSnapshot.executive_id, relations.executiveId)
    },
    items: safeArray(quotation.items),
    pricing: resolveStoredPricing(quotation),
    paymentTerms: safeObject(quotation.payment_terms)
  };
}

function resolvePdfUrl(quotation = {}, quotationDocument = {}) {
  const publicDocument = safeObject(quotationDocument.publicDocument);
  const candidates = [
    quotation.pdf_url,
    quotation.document_url,
    quotation.public_url,
    quotationDocument.pdfUrl,
    quotationDocument.pdf_url,
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

function publicQuotationDetail({ project = {}, quotation = {}, quotationDocument = {} } = {}) {
  const publicDocument = safeObject(quotationDocument.publicDocument);
  const quotationRelations = safeObject(quotation.relations);
  const projectRelations = safeObject(project.relations);
  const sourceAssets = safeArray(
    quotationRelations.sourceAssets ||
    quotationRelations.source_assets ||
    projectRelations.sourceAssets ||
    projectRelations.source_assets
  );
  return {
    projectId: project.id,
    projectNumber: project.project_number || '',
    quotationId: quotation.id,
    quotationNumber: quotation.quotation_number || publicDocument.quotationNumber || '',
    platformId: quotation.platform_id || project.platform_id || '',
    status: quotation.status || project.status || '',
    issuedAt: quotation.issued_at || publicDocument.issuedAt || null,
    validUntil: quotation.valid_until || publicDocument.validUntil || null,
    customerId: quotation.customer_id || project.customer_id || '',
    executiveId: quotation.executive_id || project.executive_id || '',
    totalUsd: quotation.total_usd,
    payableTotalNio: quotation.payable_total_nio,
    pdfUrl: resolvePdfUrl(quotation, quotationDocument),
    metadata: {
      sourceAssets
    },
    createdAt: quotation.created_at || project.created_at,
    updatedAt: quotation.updated_at || project.updated_at,
    quotation_document: {
      schemaVersion: quotationDocument.schemaVersion || '1.0.0',
      documentType: quotationDocument.documentType || 'quotation',
      platformId: quotationDocument.platformId || quotation.platform_id || project.platform_id || '',
      quotationNumber: quotationDocument.quotationNumber || quotation.quotation_number || '',
      brandSnapshot: quotationDocument.brandSnapshot,
      executiveSnapshot: quotationDocument.executiveSnapshot,
      template: quotationDocument.template,
      publicDocument
    }
  };
}

export class ProjectQueryService {
  constructor({ adapter, now = () => new Date() } = {}) {
    if (!adapter) throw new Error('ProjectQueryService requiere adapter');
    this.adapter = adapter;
    this.now = now;
  }

  async getProjectById(projectId) {
    if (!String(projectId || '').trim()) {
      const error = new Error('projectId es obligatorio');
      error.code = 'PROJECT_ID_REQUIRED';
      throw error;
    }
    const project = await this.adapter.getProjectById(projectId);
    return project ? publicProject(project) : null;
  }

  async getQuotationDetailByReference(reference, { platformId } = {}) {
    const id = String(reference || '').trim();
    if (!id) {
      const error = new Error('reference es obligatorio');
      error.code = 'PROJECT_REFERENCE_REQUIRED';
      throw error;
    }

    let project = null;
    let quotation = null;

    if (UUID_PATTERN.test(id)) {
      project = await this.adapter.getProjectById(id);
      if (project?.quotation_id) quotation = await this.adapter.getQuotationById(project.quotation_id);
      if (!quotation) {
        quotation = await this.adapter.getQuotationById(id);
        if (quotation?.id && typeof this.adapter.getProjectByQuotationId === 'function') {
          project = await this.adapter.getProjectByQuotationId(quotation.id);
        }
      }
    } else if (typeof this.adapter.getQuotationByNumber === 'function') {
      quotation = await this.adapter.getQuotationByNumber(id);
      if (quotation?.id && typeof this.adapter.getProjectByQuotationId === 'function') {
        project = await this.adapter.getProjectByQuotationId(quotation.id);
      }
    }

    if (!project && !quotation) {
      try {
        project = await this.adapter.getProjectById(id);
        if (project?.quotation_id) quotation = await this.adapter.getQuotationById(project.quotation_id);
      } catch (error) {
        if (!isInvalidUuidError(error)) throw error;
      }
    }

    if (!project || !quotation) return null;
    if (!samePlatform({ quotation, project, platformId })) return null;

    const document = buildStoredDocument({ quotation, project });
    const quotationDocument = buildQuotationDocument({ document, quotation, project });
    return publicQuotationDetail({ project, quotation, quotationDocument });
  }

  async getProjectStatus(projectId) {
    if (!String(projectId || '').trim()) {
      const error = new Error('projectId es obligatorio');
      error.code = 'PROJECT_ID_REQUIRED';
      throw error;
    }
    const project = await this.adapter.getProjectById(projectId);
    return project ? publicProjectStatus(project) : null;
  }

  async listQuotations({ status, platformId, limit = 100 } = {}) {
    const quotations = await this.adapter.listQuotations({ status, limit });
    const results = [];

    for (const quotation of quotations) {
      const project = typeof this.adapter.getProjectByQuotationId === 'function'
        ? await this.adapter.getProjectByQuotationId(quotation.id)
        : null;
      if (!samePlatform({ quotation, project: project || {}, platformId })) continue;
      results.push(publicQuotation(quotation, project || {}));
    }

    return results;
  }

  async getProjectsByCustomer({ customerQuery, status, executiveId, limit = 100 } = {}) {
    const projects = await this.adapter.listProjects({ executiveId, status, limit });
    return projects.filter((row) => matchesCustomer(row, customerQuery)).map(publicProject);
  }

  async getProductionProjects({ customerQuery, executiveId, limit = 100 } = {}) {
    const projects = await this.adapter.listProjects({ executiveId, status: 'production', limit });
    return projects.filter((row) => matchesCustomer(row, customerQuery)).map(publicProject);
  }

  async getQuotationsWithoutFollowUp({ executiveId, staleDays = 3, limit = 100 } = {}) {
    const quotations = await this.adapter.listQuotations({ executiveId, limit });
    const now = this.now();
    const results = [];

    for (const row of quotations) {
      if (!ACTIVE_QUOTATION_STATUSES.has(row.status)) continue;

      const followUp = typeof this.adapter.getFollowUpByQuotationId === 'function'
        ? await this.adapter.getFollowUpByQuotationId(row.id)
        : null;
      const lastActivity = asDate(
        followUp?.last_follow_up_at || row.viewed_at || row.sent_at || row.updated_at || row.created_at
      );
      const nextFollowUp = asDate(followUp?.next_follow_up_at);
      const staleForDays = lastActivity ? daysBetween(lastActivity, now) : null;
      const nextActionMissing = !followUp?.next_action;
      const nextFollowUpOverdue = nextFollowUp ? nextFollowUp < now : false;
      const stale = staleForDays === null || staleForDays >= staleDays;

      if (stale && (nextActionMissing || nextFollowUpOverdue || !nextFollowUp)) {
        results.push({
          ...publicQuotation(row),
          lastFollowUpAt: followUp?.last_follow_up_at || '',
          nextFollowUpAt: followUp?.next_follow_up_at || '',
          nextAction: followUp?.next_action || '',
          staleForDays,
          reason: nextFollowUpOverdue
            ? 'next_follow_up_overdue'
            : nextActionMissing
              ? 'next_action_missing'
              : 'follow_up_missing'
        });
      }
    }

    return results;
  }

  async getDepositsWithoutWorkOrder({ executiveId, limit = 100 } = {}) {
    const quotations = await this.adapter.listQuotations({ executiveId, status: 'deposit_confirmed', limit });
    const results = [];

    for (const quotation of quotations) {
      const projects = await this.adapter.listProjects({ executiveId, customerId: quotation.customer_id, limit });
      const project = projects.find((row) => row.quotation_id === quotation.id);
      if (!project) continue;

      const workOrders = typeof this.adapter.listWorkOrders === 'function'
        ? await this.adapter.listWorkOrders({ projectId: project.id, limit: 1 })
        : [];

      if (!workOrders.length) {
        results.push({
          ...publicQuotation(quotation),
          project: publicProject(project),
          reason: 'deposit_confirmed_without_work_order'
        });
      }
    }

    return results;
  }

  async getProjectsBlockedByPurchases({ executiveId, limit = 100 } = {}) {
    const projects = await this.adapter.listProjects({ executiveId, limit });
    const candidates = projects.filter((row) => ACTIVE_PROJECT_STATUSES.has(row.status));
    const results = [];

    for (const project of candidates) {
      const purchaseOrders = typeof this.adapter.listPurchaseOrders === 'function'
        ? await this.adapter.listPurchaseOrders({ projectId: project.id, limit: 100 })
        : [];
      const blocking = purchaseOrders.filter((order) =>
        ['draft', 'pending_approval', 'approved', 'ordered', 'partially_received'].includes(order.status)
        && order.blocks_production !== false
      );

      if (blocking.length) {
        results.push({
          ...publicProject(project),
          blockingPurchaseOrders: blocking.map((order) => ({
            purchaseOrderId: order.id,
            purchaseOrderNumber: order.purchase_order_number,
            supplierId: order.supplier_id,
            status: order.status,
            expectedAt: order.expected_at || ''
          })),
          reason: 'purchase_block'
        });
      }
    }

    return results;
  }
}

export function summarizeOperationalQuery(type, rows = []) {
  return { type, count: rows.length, hasResults: rows.length > 0, rows };
}

export const projectQueryMappers = Object.freeze({ publicProject, publicProjectStatus, publicQuotation });
