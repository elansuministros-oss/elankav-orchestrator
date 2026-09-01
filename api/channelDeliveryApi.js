'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const {
  ChannelDeliveryError,
  createChannelDeliveryService
} = require('../services/channelDeliveryService');

const MAX_BODY_BYTES = 128 * 1024;

function clean(value) {
  return String(value || '').trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function deriveChannelInternalToken(rootSecret) {
  const secret = clean(rootSecret);
  if (!secret) return '';
  return createHmac('sha256', secret)
    .update('ELANKAV_CHANNEL_INTERNAL_V1')
    .digest('hex');
}

function configuredTokens(env = process.env) {
  return Array.from(new Set([
    clean(env.ORCHESTRATOR_INTERNAL_TOKEN),
    clean(env.CONNECT_INTERNAL_TOKEN),
    deriveChannelInternalToken(env.VQS_API_TOKEN)
  ].filter(Boolean)));
}

function configuredToken(env = process.env) {
  return configuredTokens(env)[0] || '';
}

function providedToken(req) {
  const bearer = clean(req.headers.authorization);
  if (/^Bearer\s+/i.test(bearer)) {
    return bearer.replace(/^Bearer\s+/i, '').trim();
  }
  return clean(req.headers['x-elankav-internal-token']);
}

function authorized(req, env = process.env) {
  const provided = providedToken(req);
  return configuredTokens(env).some(expected =>
    expected && safeEqual(provided, expected)
  );
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
        reject(new ChannelDeliveryError(
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
        reject(new ChannelDeliveryError('INVALID_JSON', 'JSON inválido.', 400));
      }
    });

    req.on('error', reject);
  });
}

function createChannelDeliveryApi({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const service = createChannelDeliveryService({ env, fetchImpl });

  return async function handleChannelDeliveryApi({
    req,
    res,
    sendJson
  }) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/internal/channels/')) return false;

    if (!authorized(req, env)) {
      sendJson(res, configuredToken(env) ? 401 : 503, {
        ok: false,
        error: {
          code: configuredToken(env)
            ? 'CHANNEL_INTERNAL_UNAUTHORIZED'
            : 'CHANNEL_INTERNAL_TOKEN_REQUIRED',
          message: configuredToken(env)
            ? 'No autorizado.'
            : 'El token interno del Orchestrator no está configurado.'
        }
      });
      return true;
    }

    try {
      if (url.pathname === '/api/internal/channels/capabilities') {
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

      if (url.pathname === '/api/internal/channels/deliver') {
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

      if (url.pathname === '/api/internal/channels/email/messages') {
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
        /^\/api\/internal\/channels\/email\/messages\/([^/]+)$/
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
          code: 'CHANNEL_INTERNAL_ROUTE_NOT_FOUND',
          message: 'Ruta interna de canales no encontrada.'
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
          code: clean(error?.code) || 'CHANNEL_INTERNAL_ERROR',
          message: clean(error?.message) || 'Falló el transporte de canal.'
        }
      });
      return true;
    }
  };
}

module.exports = {
  authorized,
  configuredToken,
  configuredTokens,
  createChannelDeliveryApi,
  deriveChannelInternalToken,
  readJsonBody
};
