'use strict';

const crypto = require('node:crypto');
const {
  ConnectToolGatewayService
} = require('../services/connectToolGatewayService');

const ROUTE = '/api/tools/connect';
const MAX_BODY_BYTES = 1024 * 1024;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAuthorized(req) {
  const configured = String(process.env.ELAN_AI_INTERNAL_TOKEN || '').trim();
  const provided = String(req.headers?.['x-elan-ai-token'] || '').trim();
  return Boolean(configured) && safeEqual(provided, configured);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;

    req.on('data', chunk => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        const error = new Error('CONNECT_TOOL_PAYLOAD_TOO_LARGE');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        const error = new Error('CONNECT_TOOL_JSON_INVALID');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function handleConnectToolApi({
  req,
  res,
  sendJson,
  service = new ConnectToolGatewayService()
} = {}) {
  const pathname = new URL(
    req.url,
    `http://${req.headers?.host || 'localhost'}`
  ).pathname;
  if (pathname !== ROUTE) return false;

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    sendJson(res, 405, {
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido' }
    });
    return true;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Credencial interna inválida' }
    });
    return true;
  }

  try {
    const body = await readJsonBody(req);
    const result = await service.execute(body);
    sendJson(res, 200, { success: true, result });
  } catch (error) {
    const statusCode = error.statusCode ||
      (/^CONNECT_HTTP_(\d+)$/.exec(error.code || '')?.[1]
        ? Number(/^CONNECT_HTTP_(\d+)$/.exec(error.code)[1])
        : 502);
    sendJson(res, statusCode, {
      success: false,
      error: {
        code: error.code || error.message || 'CONNECT_TOOL_FAILED',
        message: 'No fue posible ejecutar la operación en CONNECT',
        ...(error.details ? { details: error.details } : {})
      }
    });
  }

  return true;
}

module.exports = {
  ROUTE,
  handleConnectToolApi,
  isAuthorized,
  readJsonBody
};
