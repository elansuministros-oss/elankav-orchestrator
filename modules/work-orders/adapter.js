const WORK_ORDER_TABLE = 'elankav_ops_work_orders';

function assertSupabase(client) {
  if (!client || typeof client.from !== 'function') {
    throw new Error('SupabaseWorkOrderAdapter requiere un cliente Supabase valido');
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

class SupabaseWorkOrderAdapter {
  constructor({ supabase, table = WORK_ORDER_TABLE } = {}) {
    assertSupabase(supabase);
    this.supabase = supabase;
    this.table = table;
  }

  create(row) {
    return this.supabase.from(this.table).insert(row).select('*').single().then((result) =>
      unwrap(result, 'No se pudo crear la orden de trabajo')
    );
  }

  list({ platformId, status, sourceType, caseId, quotationId, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.table)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (platformId) query = query.eq('platform_id', platformId);
    if (status) query = query.eq('status', status);
    if (sourceType) query = query.eq('source_type', sourceType);
    if (caseId) query = query.eq('case_id', caseId);
    if (quotationId) query = query.eq('quotation_id', quotationId);

    return Promise.resolve(query).then((result) => unwrap(result, 'No se pudieron consultar las ordenes de trabajo') || []);
  }

  getById(id) {
    return this.supabase.from(this.table).select('*').eq('id', id).maybeSingle().then((result) =>
      unwrap(result, 'No se pudo consultar la orden de trabajo')
    );
  }

  update(id, patch) {
    return this.supabase
      .from(this.table)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
      .then((result) => unwrap(result, 'No se pudo actualizar la orden de trabajo'));
  }

  countByCaseId(caseId) {
    return this.supabase
      .from(this.table)
      .select('*')
      .eq('case_id', caseId)
      .then((result) => unwrap(result, 'No se pudieron contar las ordenes de trabajo') || [])
      .then((rows) => rows.length);
  }
}

module.exports = {
  WORK_ORDER_TABLE,
  SupabaseWorkOrderAdapter
};
