const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');
const { SupabaseWorkOrderAdapter } = require('../modules/work-orders/adapter');
const { WorkOrderRepository } = require('../modules/work-orders/repository');
const { WorkOrderService } = require('../modules/work-orders/services');
const { SupabasePurchaseOrderAdapter } = require('../modules/purchase-orders/adapter');
const { PurchaseOrderRepository } = require('../modules/purchase-orders/repository');
const { SupabaseMasterCaseAdapter } = require('../modules/master-cases/adapter');
const { MasterCaseRepository } = require('../modules/master-cases/repository');
const { DocumentLineageNumberService } = require('../modules/master-cases/numbering');

const COLLECTION_ROUTE = '/api/work-orders';
const MAX_BODY_BYTES = 1024 * 1024;

let servicePromise = null;

class HttpBodyError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function parsedUrl(url = '') {
  try { return new URL(url, 'http://localhost'); }
  catch { return new URL('http://localhost'); }
}

function pathnameOf(url = '') {
  return parsedUrl(url).pathname;
}

function matchWorkOrderRoute(pathname) {
  if (pathname === COLLECTION_ROUTE) return { type: 'collection' };
  const match = pathname.match(/^\/api\/work-orders\/([^/]+)(?:\/(status))?$/);
  if (!match) return null;
  return {
    type: match[2] === 'status' ? 'status' : 'detail',
    id: decodeURIComponent(match[1])
  };
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(new HttpBodyError('El cuerpo excede el tamano permitido', 413, 'PAYLOAD_TOO_LARGE'));
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
        settled = true;
        resolve(JSON.parse(raw));
      } catch {
        fail(new HttpBodyError('JSON invalido', 400, 'INVALID_JSON'));
      }
    });
  });
}

function resolveActor(req = {}, body = {}) {
  return {
    type: req.headers?.['x-elankav-actor-type'] || body.actor?.type || 'user',
    userId: req.headers?.['x-elankav-user-id'] || body.actor?.userId || '',
    role: req.headers?.['x-elankav-role'] || body.actor?.role || '',
    platformId: req.headers?.['x-elankav-platform'] || body.platformId || body.workOrder?.platformId || ''
  };
}

async function getDefaultService() {
  if (!servicePromise) {
    servicePromise = (async () => {
      const supabase = getSupabaseClient();
      const { SupabaseQuoteProjectAdapter } = await import('../adapters/quoteCore/supabaseQuoteProjectAdapter.js');
      const adapter = new SupabaseWorkOrderAdapter({ supabase });
      const repository = new WorkOrderRepository({ adapter });
      const purchaseOrderRepository = new PurchaseOrderRepository({
        adapter: new SupabasePurchaseOrderAdapter({ supabase })
      });
      const masterCaseRepository = new MasterCaseRepository({
        adapter: new SupabaseMasterCaseAdapter({ supabase })
      });
      const lineageNumberService = new DocumentLineageNumberService({
        masterCaseRepository,
        workOrderRepository: repository,
        purchaseOrderRepository,
        quotationRepository: new SupabaseQuoteProjectAdapter({ supabase })
      });
      return new WorkOrderService({
        repository,
        lineageNumberService
      });
    })();
  }
  return servicePromise;
}

function resetWorkOrderApiForTests() {
  servicePromise = null;
}

async function resolveService(service) {
  return service || getDefaultService();
}

function sendNotFound(res, sendJson) {
  sendJson(res, 404, { success: false, error: 'Orden de trabajo no encontrada', code: 'WORK_ORDER_NOT_FOUND' });
}

function isConflictError(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.cause?.code || ''} ${error?.cause?.message || ''}`;
  return /23505|duplicate|duplicad|unique|CONFLICT|COLLISION/i.test(text);
}

async function handleWorkOrderApi({ req, res, sendJson, service } = {}) {
  const route = matchWorkOrderRoute(pathnameOf(req?.url));
  if (!route) return false;

  try {
    const workOrderService = await resolveService(service);

    if (route.type === 'collection') {
      if (req.method === 'GET') {
        const url = parsedUrl(req.url);
        const filters = {
          platformId: String(url.searchParams.get('platform') || '').trim().toUpperCase() || undefined,
          status: String(url.searchParams.get('status') || '').trim() || undefined,
          sourceType: String(url.searchParams.get('sourceType') || '').trim() || undefined,
          caseId: String(url.searchParams.get('caseId') || '').trim() || undefined,
          quotationId: String(url.searchParams.get('quotationId') || '').trim() || undefined,
          limit: Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 200)
        };
        const rows = await workOrderService.list(filters);
        sendJson(res, 200, { success: true, data: rows, count: rows.length });
        return true;
      }

      if (req.method !== 'POST') {
        res.setHeader?.('Allow', 'GET, POST');
        sendJson(res, 405, { success: false, error: 'Metodo no permitido', code: 'METHOD_NOT_ALLOWED' });
        return true;
      }

      const body = await readJsonBody(req);
      const result = await workOrderService.create(body, resolveActor(req, body));
      sendJson(res, 201, { success: true, data: result.workOrder, document: result.document });
      return true;
    }

    if (route.type === 'status') {
      if (req.method !== 'PATCH') {
        res.setHeader?.('Allow', 'PATCH');
        sendJson(res, 405, { success: false, error: 'Metodo no permitido', code: 'METHOD_NOT_ALLOWED' });
        return true;
      }
      const body = await readJsonBody(req);
      const updated = await workOrderService.changeStatus(route.id, body.status, resolveActor(req, body));
      if (!updated) return sendNotFound(res, sendJson), true;
      sendJson(res, 200, { success: true, data: updated });
      return true;
    }

    if (req.method === 'GET') {
      const workOrder = await workOrderService.getById(route.id);
      if (!workOrder) return sendNotFound(res, sendJson), true;
      sendJson(res, 200, { success: true, data: workOrder });
      return true;
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const updated = await workOrderService.update(route.id, body, resolveActor(req, body));
      if (!updated) return sendNotFound(res, sendJson), true;
      sendJson(res, 200, { success: true, data: updated });
      return true;
    }

    res.setHeader?.('Allow', 'GET, PATCH');
    sendJson(res, 405, { success: false, error: 'Metodo no permitido', code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (error instanceof HttpBodyError) {
      sendJson(res, error.statusCode, { success: false, error: error.message, code: error.code });
    } else if (isConflictError(error)) {
      sendJson(res, 409, { success: false, error: 'Conflicto de orden de trabajo', code: 'WORK_ORDER_CONFLICT' });
    } else if (['WORK_ORDER_VALIDATION_ERROR', 'WORK_ORDER_UPDATE_VALIDATION_ERROR', 'WORK_ORDER_STATUS_VALIDATION_ERROR'].includes(error?.code) || String(error?.code || '').startsWith('DOCUMENT_LINEAGE_')) {
      sendJson(res, 422, { success: false, error: 'Orden de trabajo invalida', code: error.code, details: error.details || [] });
    } else if (error instanceof SupabaseConfigurationError || error?.code === 'SUPABASE_CONFIGURATION_ERROR') {
      sendJson(res, 503, { success: false, error: 'Persistencia no disponible', code: 'SUPABASE_CONFIGURATION_ERROR' });
    } else {
      console.error('[WORK_ORDER_API_ERROR]', error?.code || error?.message || 'UNKNOWN_ERROR');
      sendJson(res, 500, { success: false, error: 'No fue posible procesar la orden de trabajo', code: 'WORK_ORDER_API_ERROR' });
    }
  }

  return true;
}

module.exports = {
  handleWorkOrderApi,
  matchWorkOrderRoute,
  readJsonBody,
  resolveActor,
  resetWorkOrderApiForTests
};
