const { handleVqsProjectApi } = require('./vqsProjectApi');
const { handleMessageApi: handleLegacyMessageApi } = require('./messageApiLegacy');

const VQS_ROUTE_PREFIX = '/api/vqs/';
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

function applyVqsCors(req, res) {
  if (!isVqsRequest(req)) return { handled: false, allowed: true };

  const origin = String(req?.headers?.origin || '').trim();
  const allowedOrigins = getAllowedOrigins();
  const allowed = !origin || allowedOrigins.has(origin);

  res.setHeader?.('Vary', 'Origin');
  res.setHeader?.('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
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

  const vqsProjectHandled = await handleVqsProjectApi({ req, res, sendJson });
  if (vqsProjectHandled) return true;

  return handleLegacyMessageApi({ req, res, sendJson });
}

module.exports = {
  handleMessageApi,
  applyVqsCors,
  getAllowedOrigins,
  isVqsRequest
};