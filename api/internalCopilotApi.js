'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { processMessage } = require('../services/messageService');
const { getOwnerPhone } = require('../services/context/contextBuilder');

const MAX_BODY_BYTES = 64 * 1024;

function clean(value) {
  return String(value || '').trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function deriveCopilotInternalToken(rootSecret) {
  const secret = clean(rootSecret);
  if (!secret) return '';

  return createHmac('sha256', secret)
    .update('ELANKAV_COPILOT_INTERNAL_V1')
    .digest('hex');
}

function configuredToken(env = process.env) {
  return deriveCopilotInternalToken(env.ORCHESTRATOR_INTERNAL_TOKEN);
}

function providedToken(req = {}) {
  const headers = req.headers || {};
  const authorization = clean(headers.authorization);

  if (/^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, '').trim();
  }

  return clean(headers['x-elankav-internal-token']);
}

function authorized(req, env = process.env) {
  const expected = configuredToken(env);
  const provided = providedToken(req);
  return Boolean(expected && safeEqual(provided, expected));
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
        const error = new Error('PAYLOAD_TOO_LARGE');
        error.code = 'PAYLOAD_TOO_LARGE';
        error.status = 413;
        reject(error);
        req.destroy?.();
        return;
      }

      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (done) return;
      done = true;

      if (!body.trim()) {
        const error = new Error('BODY_REQUIRED');
        error.code = 'BODY_REQUIRED';
        error.status = 400;
        reject(error);
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('INVALID_JSON');
        error.code = 'INVALID_JSON';
        error.status = 400;
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function createInternalCopilotApi({
  env = process.env,
  processMessageFn = processMessage,
  ownerPhoneResolver = getOwnerPhone
} = {}) {
  return async function handleInternalCopilotApi({ req, res, sendJson }) {
    const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);

    if (url.pathname !== '/api/internal/copilot/messages') {
      return false;
    }

    if (!configuredToken(env)) {
      sendJson(res, 503, {
        ok: false,
        error: {
          code: 'COPILOT_INTERNAL_TOKEN_REQUIRED',
          message: 'Credencial interna no configurada.'
        }
      });
      return true;
    }

    if (!authorized(req, env)) {
      sendJson(res, 401, {
        ok: false,
        error: {
          code: 'COPILOT_INTERNAL_UNAUTHORIZED',
          message: 'No autorizado.'
        }
      });
      return true;
    }

    if (req.method !== 'POST') {
      res.setHeader?.('Allow', 'POST');
      sendJson(res, 405, {
        ok: false,
        error: { code: 'METHOD_NOT_ALLOWED' }
      });
      return true;
    }

    const contentType = clean(req.headers?.['content-type']).toLowerCase();

    if (!contentType.includes('application/json')) {
      sendJson(res, 415, {
        ok: false,
        error: { code: 'CONTENT_TYPE_REQUIRED' }
      });
      return true;
    }

    try {
      const payload = await readJsonBody(req);
      const message = clean(payload.message);

      if (!message) {
        sendJson(res, 400, {
          ok: false,
          error: {
            code: 'MESSAGE_REQUIRED',
            message: 'Mensaje requerido.'
          }
        });
        return true;
      }

      const ownerPhone = clean(ownerPhoneResolver());

      if (!ownerPhone) {
        sendJson(res, 503, {
          ok: false,
          error: {
            code: 'COPILOT_OWNER_IDENTITY_NOT_CONFIGURED'
          }
        });
        return true;
      }

      /*
       * SECURITY:
       * identity, channel and platform are server-authoritative.
       * Values supplied by the caller for phone/externalUserId/channel/role
       * are intentionally ignored.
       */
      const result = await processMessageFn({
        message,
        platform: 'ELANVISUAL',
        channel: 'copilot',
        externalUserId: ownerPhone,
        phone: ownerPhone,
        metadata: {
          source: 'elan-copilot-internal',
          messageType: 'text',
          conversationId: clean(payload.conversationId) || null
        }
      });

      sendJson(res, 200, {
        ok: true,
        result
      });

      return true;
    } catch (error) {
      sendJson(res, Number(error?.status) || 502, {
        ok: false,
        error: {
          code: error?.code || 'COPILOT_INTERNAL_FAILED',
          message: 'No fue posible procesar la solicitud.'
        }
      });
      return true;
    }
  };
}

module.exports = {
  authorized,
  configuredToken,
  createInternalCopilotApi,
  deriveCopilotInternalToken,
  providedToken,
  safeEqual
};
