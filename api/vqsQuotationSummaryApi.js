const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');

let servicesPromise = null;

function parsedUrl(url = '') {
  try { return new URL(url, 'http://localhost'); }
  catch { return new URL('http://localhost'); }
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePlatformId(value = '') {
  return String(value || '').trim().toUpperCase();
}

function samePlatform(quotation = {}, project = {}, platformId = '') {
  const expected = normalizePlatformId(platformId);
  if (!expected) return true;
  return [quotation.platform_id, project.platform_id]
    .map(normalizePlatformId)
    .some((value) => value === expected);
}

function normalizeLimit(value, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, Math.trunc(parsed)));
}

function mapQuotationSummary(quotation = {}, project = {}) {
  const customer = safeObject(quotation.customer_snapshot);
  const executive = safeObject(quotation.executive_snapshot);
  const customerName = firstText(quotation.customer_name, customer.name, customer.fullName);
  const customerCompanyName = firstText(
    quotation.customer_company_name,
    customer.companyName,
    customer.company_name,
    customer.company
  );
  const customerPhone = firstText(customer.phone, customer.whatsapp, customer.telefono, customer.celular);
  const customerEmail = firstText(customer.email, customer.correo);
  const executiveName = firstText(executive.name, executive.fullName, executive.displayName);
  const executivePhone = firstText(executive.phone, executive.whatsapp, executive.telefono);
  const executiveEmail = firstText(executive.email, executive.correo);
  const projectId = firstText(project.id, quotation.project_id);
  const customerId = firstText(quotation.customer_id, project.customer_id, customer.customerId, customer.id);
  const executiveId = firstText(quotation.executive_id, project.executive_id, executive.executiveId, executive.id);

  return {
    id: projectId,
    projectId,
    projectNumber: firstText(project.project_number, quotation.project_number),
    quotationId: quotation.id,
    quotationNumber: quotation.quotation_number,
    platformId: firstText(quotation.platform_id, project.platform_id),
    status: quotation.status,
    issuedAt: quotation.issued_at,
    validUntil: quotation.valid_until,
    totalUsd: quotation.total_usd,
    payableTotalNio: quotation.payable_total_nio,
    customerId,
    executiveId,
    customerName,
    customerCompanyName,
    customerPhone,
    customerEmail,
    executiveName,
    executivePhone,
    executiveEmail,
    customer: {
      id: customerId,
      name: customerName,
      companyName: customerCompanyName,
      phone: customerPhone,
      email: customerEmail
    },
    executive: {
      id: executiveId,
      name: executiveName,
      phone: executivePhone,
      email: executiveEmail
    }
  };
}

async function getDefaultServices() {
  if (!servicesPromise) {
    servicesPromise = import('../adapters/quoteCore/supabaseQuoteProjectAdapter.js')
      .then((adapterModule) => {
        const supabase = getSupabaseClient();
        return {
          adapter: new adapterModule.SupabaseQuoteProjectAdapter({ supabase })
        };
      });
  }
  return servicesPromise;
}

function resetVqsQuotationSummaryApiForTests() {
  servicesPromise = null;
}

async function handleVqsQuotationSummaryApi({ req, res, sendJson, services } = {}) {
  const url = parsedUrl(req?.url);
  if (req?.method !== 'GET' || url.pathname !== '/api/vqs/projects') return false;

  try {
    const runtime = services || await getDefaultServices();
    const status = String(url.searchParams.get('status') || '').trim() || undefined;
    const platformId = String(url.searchParams.get('platform') || req?.headers?.['x-elankav-platform'] || '').trim();
    const limit = normalizeLimit(url.searchParams.get('limit'), 100);
    const quotations = await runtime.adapter.listQuotations({ status, limit });
    const rows = [];

    for (const quotation of quotations) {
      const project = typeof runtime.adapter.getProjectByQuotationId === 'function'
        ? await runtime.adapter.getProjectByQuotationId(quotation.id)
        : null;
      if (!samePlatform(quotation, project || {}, platformId)) continue;
      rows.push(mapQuotationSummary(quotation, project || {}));
    }

    sendJson(res, 200, {
      success: true,
      data: rows,
      count: rows.length
    });
  } catch (error) {
    const configurationError = error instanceof SupabaseConfigurationError;
    sendJson(res, configurationError ? 503 : 500, {
      success: false,
      code: error?.code || (configurationError ? 'SUPABASE_NOT_CONFIGURED' : 'VQS_QUOTATION_SUMMARY_FAILED'),
      error: configurationError ? 'El servicio de datos no está configurado' : error?.message || 'No se pudieron consultar las cotizaciones'
    });
  }

  return true;
}

module.exports = {
  handleVqsQuotationSummaryApi,
  mapQuotationSummary,
  normalizeLimit,
  resetVqsQuotationSummaryApiForTests
};
