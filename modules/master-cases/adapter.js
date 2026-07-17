const MASTER_CASE_TABLE = 'elankav_master_cases';
const MASTER_CASE_COUNTER_TABLE = 'elankav_master_case_counters';
const DOCUMENT_AUDIT_TABLE = 'elankav_document_audit_events';

function assertSupabase(client) {
  if (!client || typeof client.from !== 'function') {
    throw new Error('SupabaseMasterCaseAdapter requiere un cliente Supabase valido');
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

function formatBaseSequence(year, value) {
  return `${year}-${String(value).padStart(6, '0')}`;
}

class SupabaseMasterCaseAdapter {
  constructor({
    supabase,
    table = MASTER_CASE_TABLE,
    counterTable = MASTER_CASE_COUNTER_TABLE,
    auditTable = DOCUMENT_AUDIT_TABLE
  } = {}) {
    assertSupabase(supabase);
    this.supabase = supabase;
    this.table = table;
    this.counterTable = counterTable;
    this.auditTable = auditTable;
  }

  create(row) {
    return this.supabase.from(this.table).insert(row).select('*').single().then((result) =>
      unwrap(result, 'No se pudo crear el expediente maestro')
    );
  }

  list({ platformId, status, caseType, quotationId, limit = 100 } = {}) {
    let query = this.supabase
      .from(this.table)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (platformId) query = query.eq('platform_id', platformId);
    if (status) query = query.eq('status', status);
    if (caseType) query = query.eq('case_type', caseType);
    if (quotationId) query = query.eq('quotation_id', quotationId);

    return Promise.resolve(query).then((result) => unwrap(result, 'No se pudieron consultar los expedientes maestros') || []);
  }

  getById(id) {
    return this.supabase.from(this.table).select('*').eq('id', id).maybeSingle().then((result) =>
      unwrap(result, 'No se pudo consultar el expediente maestro')
    );
  }

  getByCaseNumber(caseNumber) {
    return this.supabase.from(this.table).select('*').eq('case_number', caseNumber).maybeSingle().then((result) =>
      unwrap(result, 'No se pudo consultar el expediente por numero')
    );
  }

  getByQuotationId(quotationId) {
    return this.supabase.from(this.table).select('*').eq('quotation_id', quotationId).maybeSingle().then((result) =>
      unwrap(result, 'No se pudo consultar el expediente por cotizacion')
    );
  }

  update(id, patch) {
    return this.supabase
      .from(this.table)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
      .then((result) => unwrap(result, 'No se pudo actualizar el expediente maestro'));
  }

  async reserveBaseSequence({ year = new Date().getUTCFullYear() } = {}) {
    const normalizedYear = String(year);
    if (typeof this.supabase.rpc === 'function') {
      const data = await this.supabase
        .rpc('elankav_reserve_master_base_sequence', { target_year: normalizedYear })
        .then((result) => unwrap(result, 'No se pudo reservar el correlativo maestro'));
      if (typeof data === 'string' && data.trim()) return data.trim();
    }

    let current = await this.supabase
      .from(this.counterTable)
      .select('*')
      .eq('year', normalizedYear)
      .maybeSingle()
      .then((result) => unwrap(result, 'No se pudo consultar el correlativo maestro'));

    if (!current) {
      current = await this.supabase
        .from(this.counterTable)
        .insert({ year: normalizedYear, last_sequence: 0 })
        .select('*')
        .single()
        .then((result) => unwrap(result, 'No se pudo inicializar el correlativo maestro'));
    }

    const nextSequence = Number(current.last_sequence || 0) + 1;
    await this.supabase
      .from(this.counterTable)
      .update({ last_sequence: nextSequence, updated_at: new Date().toISOString() })
      .eq('year', normalizedYear)
      .select('*')
      .single()
      .then((result) => unwrap(result, 'No se pudo reservar el correlativo maestro'));

    return formatBaseSequence(normalizedYear, nextSequence);
  }

  async reserveDocumentOrdinal({ caseId, documentType } = {}) {
    if (!caseId || !documentType) {
      const error = new Error('caseId y documentType son obligatorios para reservar sufijo');
      error.code = 'DOCUMENT_SUFFIX_INPUT_INVALID';
      throw error;
    }

    if (typeof this.supabase.rpc === 'function') {
      const data = await this.supabase
        .rpc('elankav_reserve_document_suffix', {
          target_case_id: caseId,
          target_document_type: documentType
        })
        .then((result) => unwrap(result, 'No se pudo reservar el sufijo documental'));
      const ordinal = Number(data);
      if (Number.isInteger(ordinal) && ordinal > 0) return ordinal;
    }

    const error = new Error('No hay reserva transaccional de sufijos disponible');
    error.code = 'DOCUMENT_SUFFIX_RESERVATION_UNAVAILABLE';
    throw error;
  }

  recordAudit(row) {
    return this.supabase.from(this.auditTable).insert(row).select('*').single().then((result) =>
      unwrap(result, 'No se pudo registrar auditoria documental')
    );
  }
}

module.exports = {
  MASTER_CASE_TABLE,
  MASTER_CASE_COUNTER_TABLE,
  DOCUMENT_AUDIT_TABLE,
  SupabaseMasterCaseAdapter
};
