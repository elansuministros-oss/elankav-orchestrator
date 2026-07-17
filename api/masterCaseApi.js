const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');
const { SupabaseMasterCaseAdapter } = require('../modules/master-cases/adapter');
const { MasterCaseRepository } = require('../modules/master-cases/repository');
const { MasterCaseService } = require('../modules/master-cases/services');

const COLLECTION_ROUTE = '/api/master-cases';
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

function matchMasterCaseRoute(pathname) {
  if (pathname === COLLECTION_ROUTE) return { type: 'collection' };
  const match = pathname.match(/^\/api\/master-cases\/([^/]+)$/);
  if (!match) return null;
  return { type: 'detail', id: decodeURIComponent(match[1]) };
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
    platformId: req.headers?.['x-elankav-platform'] || body.platformId || ''
  };
}

async function getDefaultService() {
  if (!servicePromise) {
    servicePromise = Promise.resolve().then(() => {
      const adapter = new SupabaseMasterCaseAdapter({ supabase: getSupabaseClient() });
      return new MasterCaseService({
        repository: new MasterCaseRepository({ adapter })
      });
    });
  }
  return servicePromise;
}

function resetMasterCaseApiForTests() {
  servicePromise = null;
}

async function resolveService(service) {
  return service || getDefaultService();
}

function sendNotFound(res, sendJson) {
  sendJson(res, 404, { success: false, error: 'Expediente maestro no encontrado', code: 'MASTER_CASE_NOT_FOUND' });
}

async function handleMasterCaseApi({ req, res, sendJson, service } = {}) {
  const route = matchMasterCaseRoute(pathnameOf(req?.url));
  if (!route) return false;

  try {
    const masterCaseService = await resolveService(service);

    if (route.type === 'collection') {
      if (req.method === 'GET') {
        const url = parsedUrl(req.url);
        const filters = {
          platformId: String(url.searchParams.get('platform') || '').trim().toUpperCase() || undefined,
          status: String(url.searchParams.get('status') || '').trim() || undefined,
          caseType: String(url.searchParams.get('caseType') || '').trim() || undefined,
          quotationId: String(url.searchParams.get('quotationId') || '').trim() || undefined,
          limit: Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 200)
        };
        const rows = await masterCaseService.list(filters);
        sendJson(res, 200, { success: true, data: rows, count: rows.length });
        return true;
      }

      if (req.method !== 'POST') {
        res.setHeader?.('Allow', 'GET, POST');
        sendJson(res, 405, { success: false, error: 'Metodo no permitido', code: 'METHOD_NOT_ALLOWED' });
        return true;
      }

      const body = await readJsonBody(req);
      const result = await masterCaseService.create(body, resolveActor(req, body));
      sendJson(res, 201, { success: true, data: result });
      return true;
    }

    if (req.method === 'GET') {
      const item = await masterCaseService.getById(route.id);
      if (!item) return sendNotFound(res, sendJson), true;
      sendJson(res, 200, { success: true, data: item });
      return true;
    }

    res.setHeader?.('Allow', 'GET');
    sendJson(res, 405, { success: false, error: 'Metodo no permitido', code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (error instanceof HttpBodyError) {
      sendJson(res, error.statusCode, { success: false, error: error.message, code: error.code });
    } else if (['MASTER_CASE_VALIDATION_ERROR', 'MASTER_CASE_STATUS_VALIDATION_ERROR'].includes(error?.code)) {
      sendJson(res, 422, { success: false, error: 'Expediente maestro invalido', code: error.code, details: error.details || [] });
    } else if (error instanceof SupabaseConfigurationError || error?.code === 'SUPABASE_CONFIGURATION_ERROR') {
      sendJson(res, 503, { success: false, error: 'Persistencia no disponible', code: 'SUPABASE_CONFIGURATION_ERROR' });
    } else {
      console.error('[MASTER_CASE_API_ERROR]', error?.code || error?.message || 'UNKNOWN_ERROR');
      sendJson(res, 500, { success: false, error: 'No fue posible procesar el expediente maestro', code: 'MASTER_CASE_API_ERROR' });
    }
  }

  return true;
}

module.exports = {
  handleMasterCaseApi,
  matchMasterCaseRoute,
  readJsonBody,
  resolveActor,
  resetMasterCaseApiForTests
};
