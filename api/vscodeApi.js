const crypto = require('node:crypto');
const {
  getVscodeServiceStatus
} = require('../services/vscodeService');
const {
  createVscodeSession,
  verifyVscodeSession
} = require('../services/vscodeAccessService');

const OWNER_PHONE = '50588388940';
const MAX_FORM_BYTES = 8 * 1024;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function configuredAccessToken() {
  return process.env.VSCODE_ACCESS_TOKEN ||
    process.env.ORCHESTRATOR_APPROVAL_TOKEN ||
    '';
}

function hasValidBearer(req) {
  const configuredToken = configuredAccessToken();

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

function isOwnerCredential(actor, token) {
  return safeEqual(String(actor || '').replace(/\D/g, ''), OWNER_PHONE) &&
    Boolean(configuredAccessToken()) &&
    safeEqual(token, configuredAccessToken());
}

function sendMethodNotAllowed(res, sendJson, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, {
    success: false,
    error: 'Método no permitido',
    allowed
  });
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(html);
}

function renderAccessPage(errorMessage = '') {
  const errorBlock = errorMessage
    ? `<p class="error">${errorMessage}</p>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Acceso VS Code Web · ELANKAV</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: Arial, sans-serif;
      background: #08111f;
      color: #f8fafc;
    }
    main {
      width: min(440px, 100%);
      padding: 28px;
      border: 1px solid #26364f;
      border-radius: 18px;
      background: #101b2e;
    }
    h1 { margin: 0 0 10px; font-size: 28px; }
    p { color: #94a3b8; line-height: 1.5; }
    label { display: block; margin: 18px 0 7px; font-weight: 700; }
    input {
      width: 100%;
      padding: 13px 14px;
      border: 1px solid #334155;
      border-radius: 10px;
      background: #0f172a;
      color: #f8fafc;
    }
    button {
      width: 100%;
      margin-top: 22px;
      padding: 13px;
      border: 0;
      border-radius: 10px;
      background: #c9a227;
      color: #08111f;
      font-weight: 800;
      cursor: pointer;
    }
    .error { color: #fca5a5; }
    small { display: block; margin-top: 16px; color: #64748b; }
  </style>
</head>
<body>
  <main>
    <h1>VS Code Web</h1>
    <p>Acceso exclusivo del propietario autorizado mediante ELANKAV Orchestrator.</p>
    ${errorBlock}
    <form method="post" action="/api/vscode/access" autocomplete="off">
      <label for="actor">Número Owner</label>
      <input id="actor" name="actor" inputmode="numeric" required>
      <label for="token">Token de acceso</label>
      <input id="token" name="token" type="password" required>
      <button type="submit">Crear sesión segura</button>
    </form>
    <small>La sesión es temporal, firmada y no concede acceso directo a infraestructura.</small>
  </main>
</body>
</html>`;
}

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;

    req.on('data', chunk => {
      if (settled) return;

      bytes += chunk.length;
      if (bytes > MAX_FORM_BYTES) {
        settled = true;
        reject(new Error('FORM_TOO_LARGE'));
        req.destroy();
        return;
      }

      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(new URLSearchParams(body));
    });

    req.on('error', error => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function handleBrowserAccess(req, res) {
  if (req.method === 'GET') {
    sendHtml(res, 200, renderAccessPage());
    return true;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendHtml(res, 405, renderAccessPage('Método no permitido.'));
    return true;
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    sendHtml(res, 415, renderAccessPage('Formato de solicitud no permitido.'));
    return true;
  }

  try {
    const form = await readFormBody(req);
    const actor = form.get('actor') || '';
    const token = form.get('token') || '';

    if (!isOwnerCredential(actor, token)) {
      sendHtml(res, 403, renderAccessPage('Credenciales no autorizadas.'));
      return true;
    }

    const session = createVscodeSession(OWNER_PHONE);
    res.writeHead(303, {
      'Set-Cookie': session.cookie,
      Location: '/vscode/',
      'Cache-Control': 'no-store'
    });
    res.end();
  } catch (error) {
    const statusCode = error.message === 'FORM_TOO_LARGE' ? 413 : 500;
    sendHtml(res, statusCode, renderAccessPage('No fue posible crear la sesión.'));
  }

  return true;
}

async function handleVscodeApi({ req, res, sendJson }) {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const pathname = requestUrl.pathname;

  if (pathname === '/api/vscode/access') {
    return handleBrowserAccess(req, res);
  }

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
  handleVscodeApi,
  isOwnerCredential,
  isOwnerRequest,
  renderAccessPage
};