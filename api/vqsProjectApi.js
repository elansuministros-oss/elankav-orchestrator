const { getSupabaseClient, SupabaseConfigurationError } = require('../services/supabase/supabaseClient');
const { normalizeProjectIntake, validateProjectIntake, toQuoteProjectInput } = require('../modules/vqs/projectIntakeContract');
const { QuotationDocumentBuilder } = require('../services/vqs/quotationDocumentBuilder');
const { ProjectDocumentOrchestrationService } = require('../services/vqs/projectDocumentOrchestrationService');
const { sendQuotationByWhatsApp } = require('../services/vqs/quotationWahaDeliveryService');

const COLLECTION_ROUTE = '/api/vqs/projects';
const MAX_BODY_BYTES = 1024 * 1024;
let servicesPromise = null;

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

function pathnameOf(url = '') { return parsedUrl(url).pathname; }

function matchProjectRoute(pathname) {
  if (pathname === COLLECTION_ROUTE) return { type: 'collection' };
  const match = pathname.match(/^\/api\/vqs\/projects\/([^/]+)(?:\/(status|send-whatsapp))?$/);
  if (!match) return null;
  const action = match[2] || '';
  return {
    type: action === 'status' ? 'status' : action === 'send-whatsapp' ? 'send-whatsapp' : 'detail',
    projectId: decodeURIComponent(match[1])
  };
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const fail = (error) => { if (!settled) { settled = true; reject(error); } };
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

function validateExternalContract(body) { return validateProjectIntake(normalizeProjectIntake(body)).errors; }
function mapExternalContract(body) { return toQuoteProjectInput(normalizeProjectIntake(body)); }

function resolveTemporaryActor(body = {}) {
  return {
    type: 'user',
    userId: '',
    role: '',
    executiveId: body.executive?.executiveId || body.executiveId || '',
    platformId: String(body.platform || '').trim().toUpperCase()
  };
}

function publicQuotation(row = {}) {
  return {
    quotationId: row.id,
    quotationNumber: row.quotation_number,
    platformId: row.platform_id,
    status: row.status,
    sourceType: row.source_type,
    sourceId: row.source_id,
    customerId: row.customer_id,
    executiveId: row.executive_id,
    customer: row.customer_snapshot || {},
    executive: row.executive_snapshot || {},
    items: Array.isArray(row.items) ? row.items : [],
    pricing: row.pricing || {},
    paymentTerms: row.payment_terms || {},
    publicUrl: row.public_url || '',
    issuedAt: row.issued_at,
    validUntil: row.valid_until,
    totalUsd: Number(row.total_usd || 0),
    payableTotalNio: Number(row.payable_total_nio || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getDefaultServices() {
  if (!servicesPromise) {
    servicesPromise = Promise.all([
      import('../adapters/quoteCore/supabaseQuoteProjectAdapter.js'),
      import('../services/quoteCore/quoteProjectService.js'),
      import('../services/quoteCore/projectQueryService.js')
    ]).then(([adapterModule, commandModule, queryModule]) => {
      const adapter = new adapterModule.SupabaseQuoteProjectAdapter({ supabase: getSupabaseClient() });
      const coreProjectService = new commandModule.QuoteProjectService({ adapter });
      return {
        projectService: new ProjectDocumentOrchestrationService({
          projectService: coreProjectService,
          documentBuilder: new QuotationDocumentBuilder()
        }),
        projectQueryService: new queryModule.ProjectQueryService({ adapter }),
        adapter
      };
    });
  }
  return servicesPromise;
}

function resetVqsProjectApiForTests() { servicesPromise = null; }
function sendNotFound(res, sendJson) { sendJson(res, 404, { success: false, error: 'Proyecto no encontrado', code: 'PROJECT_NOT_FOUND' }); }
async function resolveCommands(service) { return service || (await getDefaultServices()).projectService; }
async function resolveQueries(service) { return service || (await getDefaultServices()).projectQueryService; }

function logProjectApiError(error, route = {}) {
  console.error('[VQS_PROJECT_API_ERROR]', {
    routeType: route.type || '',
    routeProjectId: route.projectId || '',
    errorCode: error?.code || error?.cause?.code || 'UNKNOWN_ERROR',
    errorMessage: error?.message || error?.cause?.message || 'UNKNOWN_ERROR',
    stack: error?.stack || ''
  });
}

async function handleVqsProjectApi({ req, res, sendJson, projectService, projectQueryService, quotationDeliveryService } = {}) {
  const route = matchProjectRoute(pathnameOf(req?.url));
  if (!route) return false;
  try {
    if (route.type === 'collection') {
      if (req.method === 'GET') {
        const url = parsedUrl(req.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 200);
        const status = String(url.searchParams.get('status') || '').trim() || undefined;
        const platformId = String(url.searchParams.get('platform') || '').trim().toUpperCase();
        const services = await getDefaultServices();
        const rows = await services.adapter.listQuotations({ status, limit });
        const quotations = rows
          .filter((row) => !platformId || String(row.platform_id || '').toUpperCase() === platformId)
          .map(publicQuotation);
        sendJson(res, 200, { success: true, data: quotations, count: quotations.length });
        return true;
      }
      if (req.method !== 'POST') {
        res.setHeader?.('Allow', 'GET, POST');
        sendJson(res, 405, { success: false, error: 'Método no permitido', code: 'METHOD_NOT_ALLOWED' });
        return true;
      }
      const contract = normalizeProjectIntake(await readJsonBody(req));
      const validation = validateProjectIntake(contract);
      if (!validation.ok) {
        sendJson(res, 422, { success: false, error: 'Contrato inválido', code: 'VQS_CONTRACT_INVALID', contract_version: contract.contractVersion, details: validation.errors });
        return true;
      }
      const result = await (await resolveCommands(projectService)).create(toQuoteProjectInput(contract), resolveTemporaryActor(contract));
      const responseData = {
        quotation_id: result.quotation.id,
        quotation_number: result.quotation.quotation_number,
        project_id: result.project.id,
        project_number: result.project.project_number,
        status: result.project.status,
        stage: result.project.current_stage,
        quotation_document: result.quotationDocument
      };
      if (result.documentDelivery) responseData.document_delivery = result.documentDelivery;
      sendJson(res, 201, {
        success: true,
        contract_version: contract.contractVersion,
        data: responseData
      });
      return true;
    }

    if (route.type === 'send-whatsapp') {
      if (req.method !== 'POST') {
        res.setHeader?.('Allow', 'POST');
        sendJson(res, 405, { success: false, error: 'Método no permitido', code: 'METHOD_NOT_ALLOWED' });
        return true;
      }

      const body = await readJsonBody(req);
      const project = await (await resolveQueries(projectQueryService)).getProjectById(route.projectId);
      if (!project) return sendNotFound(res, sendJson), true;

      const deliver = quotationDeliveryService || sendQuotationByWhatsApp;
      const delivery = await deliver({
        ...body,
        projectId: route.projectId,
        quotationId: body.quotationId || project.quotationId
      });
      sendJson(res, 200, { success: true, data: delivery });
      return true;
    }

    if (route.type === 'status') {
      if (req.method !== 'GET') {
        res.setHeader?.('Allow', 'GET');
        sendJson(res, 405, { success: false, error: 'Método no permitido', code: 'METHOD_NOT_ALLOWED' });
        return true;
      }
      const project = await (await resolveQueries(projectQueryService)).getProjectStatus(route.projectId);
      if (!project) return sendNotFound(res, sendJson), true;
      sendJson(res, 200, { success: true, data: project });
      return true;
    }
    if (req.method === 'GET') {
      const queries = await resolveQueries(projectQueryService);
      const platformId = String(parsedUrl(req.url).searchParams.get('platform') || '').trim().toUpperCase();
      const project = typeof queries.getQuotationDetailByReference === 'function'
        ? await queries.getQuotationDetailByReference(route.projectId, { platformId })
        : await queries.getProjectById(route.projectId);
      if (!project) return sendNotFound(res, sendJson), true;
      sendJson(res, 200, { success: true, data: project });
      return true;
    }
    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const project = await (await resolveCommands(projectService)).updateProject(route.projectId, body, resolveTemporaryActor(body));
      if (!project) return sendNotFound(res, sendJson), true;
      const publicProject = await (await resolveQueries(projectQueryService)).getProjectById(route.projectId);
      sendJson(res, 200, { success: true, data: publicProject });
      return true;
    }
    res.setHeader?.('Allow', 'GET, PATCH');
    sendJson(res, 405, { success: false, error: 'Método no permitido', code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (error instanceof HttpBodyError) sendJson(res, error.statusCode, { success: false, error: error.message, code: error.code });
    else if (error?.code === 'VQS_WHATSAPP_INVALID') sendJson(res, 422, { success: false, error: 'Datos de envío inválidos', code: error.code, details: error.details || [] });
    else if (['QUOTE_VALIDATION_ERROR', 'PROJECT_UPDATE_VALIDATION_ERROR', 'VQS_INVALID_DOCUMENT'].includes(error?.code)) sendJson(res, 422, { success: false, error: 'Contrato inválido', code: error.code, details: error.details || [] });
    else if (error instanceof SupabaseConfigurationError || error?.code === 'SUPABASE_CONFIGURATION_ERROR') sendJson(res, 503, { success: false, error: 'Persistencia no disponible', code: 'SUPABASE_CONFIGURATION_ERROR' });
    else {
      logProjectApiError(error, route);
      sendJson(res, 500, { success: false, error: 'No fue posible procesar el proyecto', code: 'PROJECT_API_ERROR' });
    }
  }
  return true;
}

module.exports = { handleVqsProjectApi, matchProjectRoute, mapExternalContract, resolveTemporaryActor, validateExternalContract, readJsonBody, resetVqsProjectApiForTests, MAX_BODY_BYTES, publicQuotation, logProjectApiError };