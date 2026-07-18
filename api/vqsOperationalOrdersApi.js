const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');
const { OperationalOrdersService } = require('../services/operations/operationalOrdersService');
const { OperationalOrdersDocumentService } = require('../services/operations/operationalOrdersDocumentService');

const MAX_BODY_BYTES = 1024 * 1024;
let servicePromise = null;

function parsedUrl(url = '') {
  try { return new URL(url, 'http://localhost'); }
  catch { return new URL('http://localhost'); }
}

function matchRoute(pathname) {
  const match = pathname.match(/^\/api\/vqs\/projects\/([^/]+)\/(work-orders|purchase-orders)(?:\/([^/]+))?$/);
  if (!match) return null;
  return {
    projectId: decodeURIComponent(match[1]),
    resource: match[2],
    itemId: match[3] ? decodeURIComponent(match[3]) : ''
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

function actorFromHeaders(req = {}) {
  return {
    type: String(req.headers?.['x-elankav-actor-type'] || 'user'),
    userId: String(req.headers?.['x-elankav-user-id'] || ''),
    role: String(req.headers?.['x-elankav-role'] || ''),
    executiveId: String(req.headers?.['x-elankav-executive-id'] || ''),
    platformId: String(req.headers?.['x-elankav-platform'] || 'ELANVISUAL').toUpperCase()
  };
}

async function defaultService() {
  if (!servicePromise) {
    servicePromise = import('../adapters/quoteCore/supabaseQuoteProjectAdapter.js').then((module) => {
      const adapter = new module.SupabaseQuoteProjectAdapter({ supabase: getSupabaseClient() });
      const ordersService = new OperationalOrdersService({ adapter });
      return new OperationalOrdersDocumentService({ ordersService });
    });
  }
  return servicePromise;
}

function resetVqsOperationalOrdersApiForTests() { servicePromise = null; }

async function handleVqsOperationalOrdersApi({ req, res, sendJson, ordersService } = {}) {
  const route = matchRoute(parsedUrl(req?.url).pathname);
  if (!route) return false;

  try {
    const service = ordersService || await defaultService();
    const actor = actorFromHeaders(req);

    if (route.resource === 'work-orders') {
      if (!route.itemId && req.method === 'GET') {
        const rows = await service.listWorkOrders(route.projectId, {
          status: parsedUrl(req.url).searchParams.get('status') || undefined
        });
        sendJson(res, 200, { success: true, data: rows, count: rows.length });
        return true;
      }
      if (!route.itemId && req.method === 'POST') {
        const row = await service.createWorkOrder(route.projectId, await readJsonBody(req), actor);
        sendJson(res, 201, { success: true, data: row });
        return true;
      }
      if (route.itemId && req.method === 'GET') {
        const row = await service.getWorkOrder(route.projectId, route.itemId);
        if (!row) sendJson(res, 404, { success: false, code: 'WORK_ORDER_NOT_FOUND', error: 'OT no encontrada' });
        else sendJson(res, 200, { success: true, data: row });
        return true;
      }
      if (route.itemId && req.method === 'PATCH') {
        const row = await service.updateWorkOrder(route.projectId, route.itemId, await readJsonBody(req), actor);
        if (!row) sendJson(res, 404, { success: false, code: 'WORK_ORDER_NOT_FOUND', error: 'OT no encontrada' });
        else sendJson(res, 200, { success: true, data: row });
        return true;
      }
      res.setHeader?.('Allow', route.itemId ? 'GET, PATCH' : 'GET, POST');
      sendJson(res, 405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Método no permitido' });
      return true;
    }

    if (!route.itemId && req.method === 'GET') {
      const url = parsedUrl(req.url);
      const rows = await service.listPurchaseOrders(route.projectId, {
        status: url.searchParams.get('status') || undefined,
        supplierId: url.searchParams.get('supplierId') || undefined
      });
      sendJson(res, 200, { success: true, data: rows, count: rows.length });
      return true;
    }
    if (!route.itemId && req.method === 'POST') {
      const row = await service.createPurchaseOrder(route.projectId, await readJsonBody(req), actor);
      sendJson(res, 201, { success: true, data: row });
      return true;
    }
    if (route.itemId && req.method === 'GET') {
      const row = await service.getPurchaseOrder(route.projectId, route.itemId);
      if (!row) sendJson(res, 404, { success: false, code: 'PURCHASE_ORDER_NOT_FOUND', error: 'OC no encontrada' });
      else sendJson(res, 200, { success: true, data: row });
      return true;
    }
    if (route.itemId && req.method === 'PATCH') {
      const row = await service.updatePurchaseOrder(route.projectId, route.itemId, await readJsonBody(req), actor);
      if (!row) sendJson(res, 404, { success: false, code: 'PURCHASE_ORDER_NOT_FOUND', error: 'OC no encontrada' });
      else sendJson(res, 200, { success: true, data: row });
      return true;
    }

    res.setHeader?.('Allow', route.itemId ? 'GET, PATCH' : 'GET, POST');
    sendJson(res, 405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Método no permitido' });
    return true;
  } catch (error) {
    const code = error?.code || 'OPERATIONAL_ORDER_ERROR';
    const status = error?.statusCode || (code === 'PROJECT_NOT_FOUND' ? 404 : code.includes('VALIDATION') || code.includes('INVALID') || code.includes('LINEAGE') ? 422 : error instanceof SupabaseConfigurationError ? 503 : 500);
    sendJson(res, status, {
      success: false,
      code,
      error: status >= 500 ? 'No fue posible procesar la operación' : error.message,
      ...(error?.details ? { details: error.details } : {})
    });
    return true;
  }
}

module.exports = {
  handleVqsOperationalOrdersApi,
  matchRoute,
  readJsonBody,
  actorFromHeaders,
  resetVqsOperationalOrdersApiForTests
};
