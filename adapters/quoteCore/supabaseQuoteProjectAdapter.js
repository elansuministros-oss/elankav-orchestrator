const TABLES = Object.freeze({
  quotations: 'elankav_quotations',
  projects: 'elankav_projects',
  followUps: 'elankav_quotation_follow_ups',
  events: 'elankav_project_events',
  workOrders: 'elankav_work_orders',
  purchaseOrders: 'elankav_purchase_orders',
  receipts: 'elankav_project_receipts'
});

function assertClient(client) {
  if (!client || typeof client.from !== 'function') {
    throw new Error('SupabaseQuoteProjectAdapter requiere un cliente Supabase válido');
  }
}

function unwrap(result, context) {
  if (result?.error) {
    const error = new Error(`${context}: ${result.error.message || 'error de Supabase'}`);
    error.cause = result.error;
    throw error;
  }
  return result?.data ?? null;
}

export class SupabaseQuoteProjectAdapter {
  constructor({ supabase, tables = {} } = {}) {
    assertClient(supabase);
    this.supabase = supabase;
    this.tables = { ...TABLES, ...tables };
  }

  async createQuotation(row) {
    const result = await this.supabase.from(this.tables.quotations).insert(row).select('*').single();
    return unwrap(result, 'No se pudo crear la cotización');
  }

  async updateQuotation(quotationId, patch) {
    const result = await this.supabase
      .from(this.tables.quotations)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', quotationId)
      .select('*')
      .single();
    return unwrap(result, 'No se pudo actualizar la cotización');
  }

  async getQuotationById(quotationId) {
    const result = await this.supabase.from(this.tables.quotations).select('*').eq('id', quotationId).maybeSingle();
    return unwrap(result, 'No se pudo consultar la cotización');
  }

  async getQuotationByNumber(quotationNumber) {
    const result = await this.supabase
      .from(this.tables.quotations)
      .select('*')
      .eq('quotation_number', quotationNumber)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar la cotizacion por numero');
  }

  async listQuotations({ executiveId, status, customerId, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.tables.quotations)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (executiveId) query = query.eq('executive_id', executiveId);
    if (status) query = query.eq('status', status);
    if (customerId) query = query.eq('customer_id', customerId);

    return unwrap(await query, 'No se pudieron consultar las cotizaciones') || [];
  }

  async createProject(row) {
    const result = await this.supabase.from(this.tables.projects).insert(row).select('*').single();
    return unwrap(result, 'No se pudo crear el proyecto');
  }

  async updateProject(projectId, patch) {
    const result = await this.supabase
      .from(this.tables.projects)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .select('*')
      .single();
    return unwrap(result, 'No se pudo actualizar el proyecto');
  }

  async getProjectById(projectId) {
    const result = await this.supabase.from(this.tables.projects).select('*').eq('id', projectId).maybeSingle();
    return unwrap(result, 'No se pudo consultar el proyecto');
  }

  async getProjectByQuotationId(quotationId) {
    const result = await this.supabase
      .from(this.tables.projects)
      .select('*')
      .eq('quotation_id', quotationId)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar el proyecto por cotizacion');
  }

  async listProjects({ executiveId, status, customerId, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.tables.projects)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (executiveId) query = query.eq('executive_id', executiveId);
    if (status) query = query.eq('status', status);
    if (customerId) query = query.eq('customer_id', customerId);

    return unwrap(await query, 'No se pudieron consultar los proyectos') || [];
  }

  async upsertFollowUp(row) {
    const result = await this.supabase
      .from(this.tables.followUps)
      .upsert(row, { onConflict: 'quotation_id' })
      .select('*')
      .single();
    return unwrap(result, 'No se pudo guardar el seguimiento');
  }

  async getFollowUpByQuotationId(quotationId) {
    const result = await this.supabase
      .from(this.tables.followUps)
      .select('*')
      .eq('quotation_id', quotationId)
      .is('completed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar el seguimiento');
  }

  async appendEvent(row) {
    const result = await this.supabase.from(this.tables.events).insert(row).select('*').single();
    return unwrap(result, 'No se pudo registrar el evento');
  }

  async listWorkOrders({ projectId, quotationId, status, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.tables.workOrders)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (projectId) query = query.eq('project_id', projectId);
    if (quotationId) query = query.eq('quotation_id', quotationId);
    if (status) query = query.eq('status', status);

    return unwrap(await query, 'No se pudieron consultar las órdenes de trabajo') || [];
  }

  async listPurchaseOrders({ projectId, supplierId, status, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.tables.purchaseOrders)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (projectId) query = query.eq('project_id', projectId);
    if (supplierId) query = query.eq('supplier_id', supplierId);
    if (status) query = query.eq('status', status);

    return unwrap(await query, 'No se pudieron consultar las órdenes de compra') || [];
  }

  async listProjectReceipts({ projectId, purchaseOrderId, supplierId, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.tables.receipts)
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    if (projectId) query = query.eq('project_id', projectId);
    if (purchaseOrderId) query = query.eq('purchase_order_id', purchaseOrderId);
    if (supplierId) query = query.eq('supplier_id', supplierId);

    return unwrap(await query, 'No se pudieron consultar los recibos del proyecto') || [];
  }
}

export const QUOTE_CORE_TABLES = TABLES;
