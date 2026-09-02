'use strict';

require('./inboundCommercialRoleMessagePatch');

const Module = require('node:module');
const { PassThrough } = require('node:stream');
const liveAccessService = require('./connectLiveAccessService');

const createLiveSession =
  liveAccessService.createConnectLiveSession ||
  liveAccessService.requestLiveSession;

const isLiveModeRequest = liveAccessService.isLiveModeRequest;

const originalLoad = Module._load;
let installed = false;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function cloneRequest(req, rawBody) {
  const clone = new PassThrough();
  clone.method = req.method;
  clone.url = req.url;
  clone.headers = req.headers;
  clone.httpVersion = req.httpVersion;
  clone.socket = req.socket;
  clone.connection = req.connection;
  process.nextTick(() => clone.end(rawBody));
  return clone;
}

Module._load = function elanLiveModuleLoad(request, parent, isMain) {
  const exported = originalLoad.apply(this, arguments);
  if (installed || !String(request).endsWith('/api/wahaWebhookApi')) return exported;
  if (!exported || typeof exported.handleWahaWebhookApi !== 'function') return exported;

  installed = true;
  const originalHandler = exported.handleWahaWebhookApi;

  exported.handleWahaWebhookApi = async function liveFirstWahaHandler(args = {}) {
    const { req, res, sendJson } = args;
    let pathname = '';
    try { pathname = new URL(req.url, `http://${req.headers?.host || 'localhost'}`).pathname; } catch {}
    if (pathname !== '/webhook/inbound' || req.method !== 'POST') return originalHandler(args);

    const rawBody = await readBody(req);
    let body = {};
    try { body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {}; }
    catch { return originalHandler({ ...args, req: cloneRequest(req, rawBody) }); }

    const incoming = exported.extractIncoming(body);
    const text = String(incoming?.text || '').trim();
    if (typeof isLiveModeRequest !== 'function' || !isLiveModeRequest(text)) {
      return originalHandler({ ...args, req: cloneRequest(req, rawBody) });
    }

    try {
      if (typeof createLiveSession !== 'function') {
        throw Object.assign(new Error('CONNECT_LIVE_ACCESS_SERVICE_UNAVAILABLE'), {
          code: 'CONNECT_LIVE_ACCESS_SERVICE_UNAVAILABLE'
        });
      }

      const live = await createLiveSession({
        phone: incoming.phone,
        identity: incoming.senderRaw,
        externalUserId: incoming.senderRaw,
        platform: process.env.WAHA_DEFAULT_PLATFORM || 'ELANVISUAL'
      });

      await exported.sendWahaText({
        session: incoming.session,
        chatId: incoming.chatId,
        text: `ELAN Copiloto listo.\n${live.url}`
      });

      sendJson(res, 200, {
        ok: true,
        processed: true,
        replySent: true,
        replyType: 'text',
        ownerMode: live?.identity?.role === 'owner' || live?.session?.role === 'owner',
        elanLive: true
      });
      return true;
    } catch (error) {
      const denied = error?.status === 403;
      await exported.sendWahaText({
        session: incoming.session,
        chatId: incoming.chatId,
        text: denied
          ? 'Este número no tiene acceso autorizado a ELAN Copiloto.'
          : 'No pude crear la sesión de ELAN Copiloto en este momento.'
      }).catch(() => null);

      sendJson(res, 200, {
        ok: false,
        processed: true,
        replySent: true,
        elanLive: true,
        code: error?.code || null
      });
      return true;
    }
  };

  return exported;
};
