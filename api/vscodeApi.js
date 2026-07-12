const crypto = require('node:crypto');
const {
  getVscodeServiceStatus
} = require('../services/vscodeService');
const {
  createVscodeSession,
  verifyVscodeSession
} = require('../services/vscodeAccessService');

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

function isOwnerRequest(req) {
  return safeEqual(resolveActor(req), OWNER_PHONE) && hasValidBearer(req);
}

function sendMethodNotAllowed(res, sendJson, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, {
    success: false,
    error: 'Método no permitido',
    allowed
  });
}

async function handleVscodeApi({ req, res, sendJson }) {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const pathname = requestUrl.pathname;

  if (pathname === '/api/vscode/authorize') {
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, sendJson, ['GET']);
      return true;
    }

    try {
      const session = verifyVscodeSession(req);
      const authorized = session && safeEqual(session.actor, OWNER_PHONE);

      if (!authorized) {
        sendJson(res, 401, {
          success: false,
          error: 'Sesión VS Code Web no autorizada',
          code: 'VSCODE_SESSION_DENIED'
        });
        return true;
      }

      res.writeHead(204, {
        'Cache-Control': 'no-store',
        'X-ELANKAV-Actor': session.actor
      });
      res.end();
      return true;
    } catch (error) {
      sendJson(res, 503, {
        success: false,
        error: 'No fue posible validar la sesión VS Code Web',
        code: error.code || error.message
      });
      return true;
    }
  }

  if (pathname === '/api/vscode/session') {
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, sendJson, ['POST']);
      return true;
    }

    if (!isOwnerRequest(req)) {
      sendJson(res, 403, {
        success: false,
        error: 'Acceso denegado',
        code: 'VSCODE_ACCESS_DENIED'
      });
      return true;
    }

    try {
      const session = createVscodeSession(OWNER_PHONE);

      res.setHeader('Set-Cookie', session.cookie);
      sendJson(res, 201, {
        success: true,
        session: {
          actor: session.actor,
          expiresAt: new Date(session.expiresAt).toISOString(),
          accessMode: 'orchestrator-mediated'
        }
      });
    } catch (error) {
      sendJson(res, 503, {
        success: false,
        error: 'No fue posible crear la sesión VS Code Web',
        code: error.code || error.message
      });
    }

    return true;
  }

  if (pathname !== '/api/vscode') {
    return false;
  }

  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, sendJson, ['GET']);
    return true;
  }

  const actor = resolveActor(req);
  const authorized = safeEqual(actor, OWNER_PHONE) && hasValidBearer(req);

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