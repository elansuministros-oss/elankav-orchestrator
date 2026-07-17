const PURCHASE_ORDER_TABLE = 'elankav_ops_purchase_orders';
const PURCHASE_ORDER_RECEIPT_TABLE = 'elankav_ops_purchase_order_receipts';

function assertSupabase(client) {
  if (!client || typeof client.from !== 'function') {
    throw new Error('SupabasePurchaseOrderAdapter requiere un cliente Supabase valido');
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

class SupabasePurchaseOrderAdapter {
  constructor({ supabase, table = PURCHASE_ORDER_TABLE, receiptTable = PURCHASE_ORDER_RECEIPT_TABLE } = {}) {
    assertSupabase(supabase);
    this.supabase = supabase;
    this.table = table;
    this.receiptTable = receiptTable;
  }

  create(row) {
    return this.supabase.from(this.table).insert(row).select('*').single().then((result) =>
      unwrap(result, 'No se pudo crear la orden de compra')
    );
  }

  list({ platformId, status, supplierId, sourceType, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.table)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (platformId) query = query.eq('platform_id', platformId);
    if (status) query = query.eq('status', status);
    if (supplierId) query = query.eq('supplier_id', supplierId);
    if (sourceType) query = query.eq('source_type', sourceType);

    return Promise.resolve(query).then((result) => unwrap(result, 'No se pudieron consultar las ordenes de compra') || []);
  }

  getById(id) {
    return this.supabase.from(this.table).select('*').eq('id', id).maybeSingle().then((result) =>
      unwrap(result, 'No se pudo consultar la orden de compra')
    );
  }

  update(id, patch) {
    return this.supabase
      .from(this.table)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
      .then((result) => unwrap(result, 'No se pudo actualizar la orden de compra'));
  }

  async receive(id, receipt) {
    await this.supabase.from(this.receiptTable).insert(receipt.row).select('*').single().then((result) =>
      unwrap(result, 'No se pudo registrar la recepcion de compra')
    );
    return this.update(id, receipt.patch);
  }
}

module.exports = {
  PURCHASE_ORDER_TABLE,
  PURCHASE_ORDER_RECEIPT_TABLE,
  SupabasePurchaseOrderAdapter
};
