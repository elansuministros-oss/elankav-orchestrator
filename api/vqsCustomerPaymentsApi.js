const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');

const MAX_BODY_BYTES = 256 * 1024;
let servicesPromise = null;

function parsedUrl(url = '') {
  try { return new URL(url, 'http://localhost'); }
  catch { return new URL('http://localhost'); }
}

function matchRoute(pathname) {
  const match = pathname.match(/^\/api\/vqs\/projects\/([^/]+)\/payments(?:\/([^/]+))?$/);
  if (!match) return null;
  return {
    projectId: decodeURIComponent(match[1]),
    paymentId: match[2] ? decodeURIComponent(match[2]) : ''
  };
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error('El cuerpo excede el tamaño permitido');
        error.code = 'PAYLOAD_TOO_LARGE';
        error.statusCode = 413;
        fail(error);
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', fail);
    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        settled = true;
        resolve({});
        return;
      }
      try {
        settled = true;
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error('JSON inválido');
        error.code = 'INVALID_JSON';
        error.statusCode = 400;
        fail(error);
      }
    });
  });
}

function bearerToken(req = {}) {
  const authorization = String(req.headers?.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function authenticateRequest(req, supabase) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error('Autenticación requerida');
    error.code = 'AUTH_REQUIRED';
    error.statusCode = 401;
    throw error;
  }

  const response = await supabase.fetchImpl(`${supabase.url}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: supabase.serviceRoleKey,
      Authorization: `Bearer ${token}`
    }
  });
  const body = await response.text();
  let user = null;
  try { user = body ? JSON.parse(body) : null; }
  catch { user = null; }

  if (!response.ok || !user?.id) {
    const error = new Error('Sesión inválida o vencida');
    error.code = 'AUTH_INVALID';
    error.statusCode = 401;
    throw error;
  }

  const role = String(user.app_metadata?.role || user.user_metadata?.role || '').trim().toLowerCase();
  const allowedRoles = new Set(['owner', 'admin', 'administrator', 'sales', 'ventas', 'executive', 'finance', 'finanzas']);
  if (!allowedRoles.has(role)) {
    const error = new Error('El usuario no tiene permiso para registrar pagos');
    error.code = 'PAYMENT_ACCESS_DENIED';
    error.statusCode = 403;
    throw error;
  }

  return {
    type: 'user',
    userId: user.id,
    role,
    executiveId: String(req.headers?.['x-elankav-executive-id'] || user.user_metadata?.executiveId || ''),
    platformId: String(req.headers?.['x-elankav-platform'] || 'ELANVISUAL').toUpperCase()
  };
}

async function getDefaultServices() {
  if (!servicesPromise) {
    servicesPromise = Promise.all([
      import('../adapters/receipts/supabaseCustomerPaymentAdapter.js'),
      import('../services/receipts/customerReceiptService.js'),
      import('../adapters/quoteCore/supabaseQuoteProjectAdapter.js'),
      import('../services/quoteCore/quoteProjectService.js')
    ]).then(([paymentAdapterModule, receiptServiceModule, quoteAdapterModule, quoteServiceModule]) => {
      const supabase = getSupabaseClient();
      const quoteAdapter = new quoteAdapterModule.SupabaseQuoteProjectAdapter({ supabase });
      const paymentAdapter = new paymentAdapterModule.SupabaseCustomerPaymentAdapter({ supabase });
      const quoteProjectService = new quoteServiceModule.QuoteProjectService({ adapter: quoteAdapter });
      return {
        supabase,
        paymentAdapter,
        receiptService: new receiptServiceModule.CustomerReceiptService({
          adapter: paymentAdapter,
          quoteProjectService
        })
      };
    });
  }
  return servicesPromise;
}

function resetVqsCustomerPaymentsApiForTests() { servicesPromise = null; }

async function handleVqsCustomerPaymentsApi({ req, res, sendJson, services, authenticate = authenticateRequest } = {}) {
  const route = matchRoute(parsedUrl(req?.url).pathname);
  if (!route) return false;

  try {
    const runtime = services || await getDefaultServices();
    const actor = await authenticate(req, runtime.supabase);

    if (!route.paymentId && req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await runtime.receiptService.create({
        ...body,
        projectId: route.projectId
      }, actor);
      sendJson(res, 201, { success: true, data: result });
      return true;
    }

    if (!route.paymentId && req.method === 'GET') {
      const url = parsedUrl(req.url);
      const statuses = String(url.searchParams.get('status') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 200);
      const rows = await runtime.paymentAdapter.listCustomerPayments({
        projectId: route.projectId,
        statuses,
        limit
      });
      sendJson(res, 200, { success: true, data: rows, count: rows.length });
      return true;
    }

    if (route.paymentId && req.method === 'GET') {
      const row = await runtime.paymentAdapter.getCustomerPaymentById(route.paymentId);
      if (!row || String(row.project_id) !== String(route.projectId)) {
        sendJson(res, 404, { success: false, code: 'CUSTOMER_PAYMENT_NOT_FOUND', error: 'Pago no encontrado' });
      } else {
        sendJson(res, 200, { success: true, data: row });
      }
      return true;
    }

    res.setHeader?.('Allow', route.paymentId ? 'GET' : 'GET, POST');
    sendJson(res, 405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Método no permitido' });
    return true;
  } catch (error) {
    const code = error?.code || 'CUSTOMER_PAYMENT_API_ERROR';
    const status = error?.statusCode
      || (code === 'QUOTATION_NOT_FOUND' || code === 'PROJECT_NOT_FOUND' ? 404
        : code.includes('VALIDATION') || code.includes('INVALID') || code.includes('LINEAGE') ? 422
          : error instanceof SupabaseConfigurationError ? 503 : 500);
    sendJson(res, status, {
      success: false,
      code,
      error: status >= 500 ? 'No fue posible procesar el pago' : error.message,
      ...(error?.details ? { details: error.details } : {})
    });
    return true;
  }
}

module.exports = {
  handleVqsCustomerPaymentsApi,
  matchRoute,
  readJsonBody,
  authenticateRequest,
  resetVqsCustomerPaymentsApiForTests
};