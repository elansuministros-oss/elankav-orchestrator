const TABLES = Object.freeze({
  quotations: 'elankav_quotations',
  projects: 'elankav_projects',
  followUps: 'elankav_quotation_follow_ups',
  events: 'elankav_project_events'
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
    const result = await this.supabase
      .from(this.tables.quotations)
      .insert(row)
      .select('*')
      .single();
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
    const result = await this.supabase
      .from(this.tables.quotations)
      .select('*')
      .eq('id', quotationId)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar la cotización');
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
    const result = await this.supabase
      .from(this.tables.projects)
      .insert(row)
      .select('*')
      .single();
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
    const result = await this.supabase
      .from(this.tables.projects)
      .select('*')
      .eq('id', projectId)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar el proyecto');
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

  async appendEvent(row) {
    const result = await this.supabase
      .from(this.tables.events)
      .insert(row)
      .select('*')
      .single();
    return unwrap(result, 'No se pudo registrar el evento');
  }
}

export const QUOTE_CORE_TABLES = TABLES;
