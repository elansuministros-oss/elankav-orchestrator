const { handleVqsProjectApi } = require('./vqsProjectApi');
const { handleVqsContextApi } = require('./vqsContextApi');
const { handleVqsCustomerApi } = require('./vqsCustomerApi');
const { handleWorkOrderApi } = require('./workOrderApi');
const { handlePurchaseOrderApi } = require('./purchaseOrderApi');
const { handleMessageApi: handleLegacyMessageApi } = require('./messageApiLegacy');

const VQS_ROUTE_PREFIX = '/api/vqs/';
const PLATFORM_API_ROUTE_PREFIXES = Object.freeze([
  VQS_ROUTE_PREFIX,
  '/api/work-orders',
  '/api/purchase-orders'
]);
const DEFAULT_ALLOWED_ORIGINS = [
  'https://visual.elankav.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

function getAllowedOrigins() {
  const configured = String(process.env.VQS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function isVqsRequest(req) {
  const pathname = String(req?.url || '').split('?')[0];
  return pathname.startsWith(VQS_ROUTE_PREFIX);
}

function isPlatformApiRequest(req) {
  const pathname = String(req?.url || '').split('?')[0];
  return PLATFORM_API_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function applyVqsCors(req, res) {
  if (!isPlatformApiRequest(req)) return { handled: false, allowed: true };

  const origin = String(req?.headers?.origin || '').trim();
  const allowedOrigins = getAllowedOrigins();
  const allowed = !origin || allowedOrigins.has(origin);

  res.setHeader?.('Vary', 'Origin');
  res.setHeader?.('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader?.(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Request-Id, X-Elankav-Actor-Type, X-Elankav-Role, X-Elankav-Platform'
  );
  res.setHeader?.('Access-Control-Max-Age', '600');

  if (allowed && origin) {
    res.setHeader?.('Access-Control-Allow-Origin', origin);
  }

  if (req.method === 'OPTIONS') {
    if (!allowed) {
      res.writeHead?.(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end?.(JSON.stringify({ success: false, code: 'CORS_ORIGIN_DENIED', error: 'Origen no autorizado' }));
    } else {
      res.writeHead?.(204);
      res.end?.();
    }
    return { handled: true, allowed };
  }

  return { handled: false, allowed };
}

async function handleMessageApi({ req, res, sendJson }) {
  const cors = applyVqsCors(req, res);
  if (cors.handled) return true;

  if (isVqsRequest(req) && !cors.allowed) {
    sendJson(res, 403, {
      success: false,
      code: 'CORS_ORIGIN_DENIED',
      error: 'Origen no autorizado'
    });
    return true;
  }

  const vqsCustomerHandled = await handleVqsCustomerApi({ req, res, sendJson });
  if (vqsCustomerHandled) return true;

  const vqsContextHandled = await handleVqsContextApi({ req, res, sendJson });
  if (vqsContextHandled) return true;

  const vqsProjectHandled = await handleVqsProjectApi({ req, res, sendJson });
  if (vqsProjectHandled) return true;

  const workOrderHandled = await handleWorkOrderApi({ req, res, sendJson });
  if (workOrderHandled) return true;

  const purchaseOrderHandled = await handlePurchaseOrderApi({ req, res, sendJson });
  if (purchaseOrderHandled) return true;

  return handleLegacyMessageApi({ req, res, sendJson });
}

module.exports = {
  handleMessageApi,
  applyVqsCors,
  getAllowedOrigins,
  isVqsRequest,
  isPlatformApiRequest
};
