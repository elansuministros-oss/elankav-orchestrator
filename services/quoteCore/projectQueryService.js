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

function publicQuotation(row) {
  return {
    quotationId: row.id,
    quotationNumber: row.quotation_number,
    customerId: row.customer_id,
    executiveId: row.executive_id,
    status: row.status,
    issuedAt: row.issued_at,
    validUntil: row.valid_until,
    totalUsd: row.total_usd,
    payableTotalNio: row.payable_total_nio,
    customerName: row.customer_name || row.customer_snapshot?.name || '',
    customerCompanyName: row.customer_company_name || row.customer_snapshot?.companyName || ''
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

  async getProjectStatus(projectId) {
    if (!String(projectId || '').trim()) {
      const error = new Error('projectId es obligatorio');
      error.code = 'PROJECT_ID_REQUIRED';
      throw error;
    }
    const project = await this.adapter.getProjectById(projectId);
    return project ? publicProjectStatus(project) : null;
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
