const TABLES = Object.freeze({
  quotations: 'elankav_quotations',
  projects: 'elankav_projects',
  customerPayments: 'elankav_customer_payments'
});

function assertClient(client) {
  if (!client || typeof client.from !== 'function') {
    throw new Error('SupabaseCustomerPaymentAdapter requiere un cliente Supabase válido');
  }
}

function unwrap(result, context) {
  if (result?.error) {
    const error = new Error(`${context}: ${result.error.message || 'error de Supabase'}`);
    error.code = result.error.code || 'SUPABASE_ERROR';
    error.cause = result.error;
    throw error;
  }
  return result?.data ?? null;
}

export class SupabaseCustomerPaymentAdapter {
  constructor({ supabase, tables = {} } = {}) {
    assertClient(supabase);
    this.supabase = supabase;
    this.tables = { ...TABLES, ...tables };
  }

  async getQuotationById(quotationId) {
    const result = await this.supabase
      .from(this.tables.quotations)
      .select('*')
      .eq('id', quotationId)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar la cotización');
  }

  async getProjectById(projectId) {
    const result = await this.supabase
      .from(this.tables.projects)
      .select('*')
      .eq('id', projectId)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar el proyecto');
  }

  async createCustomerPayment(row) {
    const result = await this.supabase
      .from(this.tables.customerPayments)
      .insert(row)
      .select('*')
      .single();
    return unwrap(result, 'No se pudo registrar el pago del cliente');
  }

  async updateCustomerPayment(paymentId, patch) {
    const result = await this.supabase
      .from(this.tables.customerPayments)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', paymentId)
      .select('*')
      .single();
    return unwrap(result, 'No se pudo actualizar el pago del cliente');
  }

  async getCustomerPaymentById(paymentId) {
    const result = await this.supabase
      .from(this.tables.customerPayments)
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();
    return unwrap(result, 'No se pudo consultar el pago del cliente');
  }

  async listCustomerPayments({ quotationId, projectId, customerId, statuses, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.tables.customerPayments)
      .select('*')
      .order('paid_at', { ascending: true })
      .limit(limit);

    if (quotationId) query = query.eq('quotation_id', quotationId);
    if (projectId) query = query.eq('project_id', projectId);
    if (customerId) query = query.eq('customer_id', customerId);
    if (Array.isArray(statuses) && statuses.length) query = query.in('status', statuses);

    return unwrap(await query, 'No se pudieron consultar los pagos del cliente') || [];
  }
}

export const CUSTOMER_PAYMENT_TABLES = TABLES;
