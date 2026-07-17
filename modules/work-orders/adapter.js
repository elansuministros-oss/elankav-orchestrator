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

  list({ platformId, status, sourceType, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.table)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (platformId) query = query.eq('platform_id', platformId);
    if (status) query = query.eq('status', status);
    if (sourceType) query = query.eq('source_type', sourceType);

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
}

module.exports = {
  WORK_ORDER_TABLE,
  SupabaseWorkOrderAdapter
};
