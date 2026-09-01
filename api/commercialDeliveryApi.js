'use strict';

const { timingSafeEqual } = require('node:crypto');
const {
  CommercialDeliveryError,
  createCommercialDeliveryService
} = require('../services/commercialDeliveryService');

const MAX_BODY_BYTES = 128 * 1024;

function clean(value) {
  return String(value || '').trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function configuredToken(env = process.env) {
  return clean(
    env.ORCHESTRATOR_INTERNAL_TOKEN ||
    env.CONNECT_INTERNAL_TOKEN
  );
}

function providedToken(req) {
  const bearer = clean(req.headers.authorization);
  if (/^Bearer\s+/i.test(bearer)) {
    return bearer.replace(/^Bearer\s+/i, '').trim();
  }
  return clean(req.headers['x-elankav-internal-token']);
}

function authorized(req, env = process.env) {
  const expected = configuredToken(env);
  return Boolean(expected && safeEqual(providedToken(req), expected));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let done = false;

    req.on('data', chunk => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        done = true;
        reject(new CommercialDeliveryError(
          'PAYLOAD_TOO_LARGE',
          'Payload demasiado grande.',
          413
        ));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (done) return;
      done = true;
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new CommercialDeliveryError('INVALID_JSON', 'JSON inválido.', 400));
      }
    });

    req.on('error', reject);
  });
}

function createCommercialDeliveryApi({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const service = createCommercialDeliveryService({ env, fetchImpl });

  return async function handleCommercialDeliveryApi({
    req,
    res,
    sendJson
  }) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/internal/commercial/')) return false;

    if (!authorized(req, env)) {
      sendJson(res, configuredToken(env) ? 401 : 503, {
        ok: false,
        error: {
          code: configuredToken(env)
            ? 'COMMERCIAL_INTERNAL_UNAUTHORIZED'
            : 'COMMERCIAL_INTERNAL_TOKEN_REQUIRED',
          message: configuredToken(env)
            ? 'No autorizado.'
            : 'El token interno del Orchestrator no está configurado.'
        }
      });
      return true;
    }

    try {
      if (url.pathname === '/api/internal/commercial/capabilities') {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
          return true;
        }

        const probe = url.searchParams.get('probe') === 'true';
        const capabilities = probe
          ? await service.probeCapabilities()
          : service.capabilitySnapshot();

        sendJson(res, 200, {
          ok: true,
          probe,
          capabilities
        });
        return true;
      }

      if (url.pathname === '/api/internal/commercial/deliver') {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
          return true;
        }

        const body = await readJsonBody(req);
        const result = await service.deliver(body);
        sendJson(res, 200, { ok: true, result });
        return true;
      }

      if (url.pathname === '/api/internal/commercial/email/messages') {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
          return true;
        }
        const body = await readJsonBody(req);
        const messages = await service.listEmailMessages({
          q: body.q,
          maxResults: body.maxResults
        });
        sendJson(res, 200, { ok: true, messages });
        return true;
      }

      const messageMatch = url.pathname.match(
        /^\/api\/internal\/commercial\/email\/messages\/([^/]+)$/
      );
      if (messageMatch) {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
          return true;
        }
        const message = await service.getEmailMessage(
          decodeURIComponent(messageMatch[1])
        );
        sendJson(res, 200, { ok: true, message });
        return true;
      }

      sendJson(res, 404, {
        ok: false,
        error: {
          code: 'COMMERCIAL_INTERNAL_ROUTE_NOT_FOUND',
          message: 'Ruta comercial interna no encontrada.'
        }
      });
      return true;
    } catch (error) {
      const status = Number.isInteger(error?.status)
        ? error.status
        : Number.isInteger(error?.statusCode)
          ? error.statusCode
          : 502;
      sendJson(res, status, {
        ok: false,
        error: {
          code: clean(error?.code) || 'COMMERCIAL_INTERNAL_ERROR',
          message: clean(error?.message) || 'Falló el canal comercial.'
        }
      });
      return true;
    }
  };
}

module.exports = {
  authorized,
  createCommercialDeliveryApi,
  readJsonBody
};
