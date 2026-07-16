const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');
const { SupabaseVqsContextAdapter } = require('../adapters/vqsContext/supabaseVqsContextAdapter');
const { VqsContextResolverService } = require('../services/vqs/vqsContextResolverService');

const ROUTE = '/api/vqs/context/search';
let servicePromise = null;

function pathnameOf(url = '') {
  try { return new URL(url, 'http://localhost').pathname; }
  catch { return String(url).split('?')[0]; }
}

function actorFromRequest(req) {
  return {
    type: String(req?.headers?.['x-elankav-actor-type'] || 'user'),
    role: String(req?.headers?.['x-elankav-role'] || ''),
    platformId: String(req?.headers?.['x-elankav-platform'] || 'ELANVISUAL')
  };
}

async function getDefaultService() {
  if (!servicePromise) {
    servicePromise = Promise.resolve(new VqsContextResolverService({
      adapter: new SupabaseVqsContextAdapter({ supabase: getSupabaseClient() })
    }));
  }
  return servicePromise;
}

function resetVqsContextApiForTests() {
  servicePromise = null;
}

async function handleVqsContextApi({ req, res, sendJson, service } = {}) {
  if (pathnameOf(req?.url) !== ROUTE) return false;

  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    sendJson(res, 405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Método no permitido' });
    return true;
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const result = await (service || await getDefaultService()).search({
      query: url.searchParams.get('q'),
      type: url.searchParams.get('type') || 'all',
      limit: url.searchParams.get('limit') || 30,
      actor: actorFromRequest(req)
    });
    sendJson(res, 200, { success: true, data: result });
  } catch (error) {
    if (error?.code === 'VQS_CONTEXT_QUERY_TOO_SHORT' || error?.code === 'VQS_CONTEXT_TYPE_INVALID') {
      sendJson(res, 422, { success: false, code: error.code, error: error.message });
    } else if (error instanceof SupabaseConfigurationError || error?.code === 'SUPABASE_CONFIGURATION_ERROR') {
      sendJson(res, 503, { success: false, code: 'SUPABASE_CONFIGURATION_ERROR', error: 'Persistencia no disponible' });
    } else {
      console.error('[VQS_CONTEXT_API_ERROR]', error?.code || error?.message || 'UNKNOWN_ERROR');
      sendJson(res, 500, { success: false, code: 'VQS_CONTEXT_SEARCH_ERROR', error: 'No fue posible buscar el contexto' });
    }
  }

  return true;
}

module.exports = {
  handleVqsContextApi,
  actorFromRequest,
  pathnameOf,
  resetVqsContextApiForTests,
  ROUTE
};
