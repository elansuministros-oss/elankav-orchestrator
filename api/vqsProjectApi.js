const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');

const ROUTE = '/api/vqs/projects';
const MAX_BODY_BYTES = 1024 * 1024;
let servicePromise = null;

class HttpBodyError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function pathnameOf(url = '') {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url.split('?')[0];
  }
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(new HttpBodyError('El cuerpo excede el tamaño permitido', 413, 'PAYLOAD_TOO_LARGE'));
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => fail(new HttpBodyError('No fue posible leer la solicitud', 400, 'BODY_READ_ERROR')));
    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return fail(new HttpBodyError('El cuerpo JSON es obligatorio', 400, 'EMPTY_BODY'));
      try {
        const parsed = JSON.parse(raw);
        settled = true;
        resolve(parsed);
      } catch {
        fail(new HttpBodyError('JSON inválido', 400, 'INVALID_JSON'));
      }
    });
  });
}

function validateExternalContract(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) errors.push('El contrato debe ser un objeto JSON');
  if (!String(body?.platform || '').trim()) errors.push('platform es obligatorio');
  if (!String(body?.customer?.customerId || '').trim()) errors.push('customer.customerId es obligatorio');
  if (!String(body?.executive?.executiveId || '').trim()) errors.push('executive.executiveId es obligatorio');
  if (!Array.isArray(body?.items) || body.items.length === 0) errors.push('items debe contener al menos un ítem');
  if (!(Number(body?.pricing?.exchangeRate) > 0)) errors.push('pricing.exchangeRate debe ser mayor que cero');
  return errors;
}

function mapExternalContract(body) {
  return {
    quotation: {
      platformId: String(body.platform).trim().toUpperCase(),
      status: 'draft',
      source: {
        type: body.source?.type || 'manual',
        sourceId: body.source?.sourceId || '',
        designRequestId: body.source?.designRequestId || '',
        storeProductId: body.source?.storeProductId || '',
        storeCartId: body.source?.storeCartId || '',
        designMode: body.source?.designMode || 'optional'
      }
    },
    project: { status: 'pending_activation', currentStage: 'quotation' },
    relations: {
      customerId: body.customer.customerId,
      executiveId: body.executive.executiveId,
      designRequestId: body.source?.designRequestId || '',
      storeCartId: body.source?.storeCartId || ''
    },
    customerSnapshot: {
      name: body.customer.name || '',
      companyName: body.customer.companyName || '',
      phone: body.customer.phone || '',
      email: body.customer.email || '',
      address: body.customer.address || ''
    },
    executiveSnapshot: {
      executiveId: body.executive.executiveId,
      name: body.executive.name || '',
      role: body.executive.role || 'Ejecutivo Comercial',
      phone: body.executive.phone || '',
      email: body.executive.email || '',
      photoUrl: body.executive.photoUrl || ''
    },
    items: body.items,
    pricing: body.pricing || {},
    paymentTerms: {
      type: body.payments?.type || '60_40',
      installments: Array.isArray(body.payments?.installments) ? body.payments.installments : []
    },
    followUp: { ownerExecutiveId: body.executive.executiveId }
  };
}

function resolveTemporaryActor(body) {
  return {
    type: 'user',
    userId: '',
    role: '',
    executiveId: body.executive.executiveId,
    platformId: String(body.platform).trim().toUpperCase()
  };
}

async function getDefaultProjectService() {
  if (!servicePromise) {
    servicePromise = Promise.all([
      import('../adapters/quoteCore/supabaseQuoteProjectAdapter.js'),
      import('../services/quoteCore/quoteProjectService.js')
    ]).then(([adapterModule, serviceModule]) => {
      const adapter = new adapterModule.SupabaseQuoteProjectAdapter({ supabase: getSupabaseClient() });
      return new serviceModule.QuoteProjectService({ adapter });
    });
  }
  return servicePromise;
}

function resetVqsProjectApiForTests() {
  servicePromise = null;
}

async function handleVqsProjectApi({ req, res, sendJson, projectService } = {}) {
  if (pathnameOf(req?.url) !== ROUTE) return false;

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    sendJson(res, 405, { success: false, error: 'Método no permitido', code: 'METHOD_NOT_ALLOWED' });
    return true;
  }

  try {
    const body = await readJsonBody(req);
    const errors = validateExternalContract(body);
    if (errors.length) {
      sendJson(res, 422, { success: false, error: 'Contrato inválido', code: 'VQS_CONTRACT_INVALID', details: errors });
      return true;
    }

    const service = projectService || await getDefaultProjectService();
    const result = await service.create(mapExternalContract(body), resolveTemporaryActor(body));
    sendJson(res, 201, {
      success: true,
      data: {
        quotation_id: result.quotation.id,
        quotation_number: result.quotation.quotation_number,
        project_id: result.project.id,
        project_number: result.project.project_number,
        status: result.project.status,
        stage: result.project.current_stage
      }
    });
  } catch (error) {
    if (error instanceof HttpBodyError) {
      sendJson(res, error.statusCode, { success: false, error: error.message, code: error.code });
    } else if (error?.code === 'QUOTE_VALIDATION_ERROR') {
      sendJson(res, 422, { success: false, error: 'Contrato inválido', code: error.code, details: error.details || [] });
    } else if (error instanceof SupabaseConfigurationError || error?.code === 'SUPABASE_CONFIGURATION_ERROR') {
      sendJson(res, 503, { success: false, error: 'Persistencia no disponible', code: 'SUPABASE_CONFIGURATION_ERROR' });
    } else {
      console.error('[VQS_PROJECT_CREATE_ERROR]', error?.code || error?.message || 'UNKNOWN_ERROR');
      sendJson(res, 500, { success: false, error: 'No fue posible crear el proyecto', code: 'PROJECT_CREATE_ERROR' });
    }
  }
  return true;
}

module.exports = {
  handleVqsProjectApi,
  mapExternalContract,
  resolveTemporaryActor,
  validateExternalContract,
  readJsonBody,
  resetVqsProjectApiForTests,
  MAX_BODY_BYTES
};
