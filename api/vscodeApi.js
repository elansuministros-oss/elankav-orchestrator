const crypto = require('node:crypto');
const {
  getVscodeServiceStatus
} = require('../services/vscodeService');

const OWNER_PHONE = '50588388940';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hasValidBearer(req) {
  const configuredToken =
    process.env.VSCODE_ACCESS_TOKEN ||
    process.env.ORCHESTRATOR_APPROVAL_TOKEN ||
    '';

  if (!configuredToken) {
    return false;
  }

  const authorization = String(req.headers.authorization || '');

  return authorization.startsWith('Bearer ') && safeEqual(
    authorization.slice(7).trim(),
    configuredToken
  );
}

function resolveActor(req) {
  return String(req.headers['x-elankav-actor'] || '')
    .replace(/\D/g, '');
}

async function handleVscodeApi({ req, res, sendJson }) {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (requestUrl.pathname !== '/api/vscode') {
    return false;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, {
      success: false,
      error: 'Método no permitido',
      allowed: ['GET']
    });
    return true;
  }

  const actor = resolveActor(req);
  const isOwner = safeEqual(actor, OWNER_PHONE);
  const authorized = isOwner && hasValidBearer(req);

  if (!authorized) {
    sendJson(res, 403, {
      success: false,
      error: 'Acceso denegado',
      code: 'VSCODE_ACCESS_DENIED'
    });
    return true;
  }

  try {
    const status = await getVscodeServiceStatus({
      actor,
      hasPermission: true
    });

    sendJson(res, 200, {
      success: true,
      status
    });
  } catch (error) {
    sendJson(res, 503, {
      success: false,
      error: 'No fue posible consultar VS Code Web',
      code: error.code || error.message
    });
  }

  return true;
}

module.exports = {
  OWNER_PHONE,
  handleVscodeApi
};
