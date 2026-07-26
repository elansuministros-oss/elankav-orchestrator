'use strict';

const crypto = require('node:crypto');
const { invokeWorkspaceTool } = require('../services/workspaceToolContractService');

const MAX_BODY_BYTES = 32 * 1024;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function configuredToken() {
  return process.env.ELAN_AI_RUNTIME_TOKEN || process.env.ORCHESTRATOR_APPROVAL_TOKEN || '';
}

function authorized(req) {
  const authorization = String(req.headers.authorization || '');
  const token = configuredToken();
  return Boolean(token) && authorization.startsWith('Bearer ') && safeEqual(authorization.slice(7).trim(), token);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Solicitud demasiado grande'), { code: 'REQUEST_TOO_LARGE' }));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(Object.assign(new Error('JSON inválido'), { code: 'INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

async function handleWorkspaceIntelligenceApi({ req, res, sendJson }) {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname !== '/api/internal/workspace-tools') return false;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido' } });
    return true;
  }
  if (!authorized(req)) {
    sendJson(res, 403, { success: false, error: { code: 'WORKSPACE_ACCESS_DENIED', message: 'Acceso denegado' } });
    return true;
  }
  try {
    const body = await readJson(req);
    const actorId = String(req.headers['x-elankav-actor'] || body.actor?.id || '').trim();
    const result = await invokeWorkspaceTool({ ...body, actor: { ...(body.actor || {}), id: actorId } });
    sendJson(res, result.success ? 200 : 400, result);
  } catch (error) {
    sendJson(res, error.code === 'REQUEST_TOO_LARGE' ? 413 : 400, { success: false, error: { code: error.code || 'WORKSPACE_REQUEST_ERROR', message: error.message } });
  }
  return true;
}

module.exports = { handleWorkspaceIntelligenceApi };
