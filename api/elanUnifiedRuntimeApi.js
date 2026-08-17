'use strict';

const { getToolManifest } = require('../services/elanUnifiedToolRegistry');
const { executeThroughConnect, resolveActor } = require('../services/elanUnifiedRuntimeService');

const MANIFEST_PATH = '/api/v1/elan-runtime/tools';
const EXECUTE_PATH = '/api/v1/elan-runtime/execute';

function internalToken(env = process.env) {
  return String(
    env.ORCHESTRATOR_INTERNAL_TOKEN ||
    env.ELANKAV_ORCHESTRATOR_INTERNAL_TOKEN ||
    env.CONNECT_INTERNAL_TOKEN ||
    ''
  ).trim();
}

function authorized(req, env = process.env) {
  const expected = internalToken(env);
  if (!expected) return { ok: false, status: 503, code: 'ELAN_RUNTIME_AUTH_NOT_CONFIGURED' };
  const authorization = String(req?.headers?.authorization || '').trim();
  const internal = String(req?.headers?.['x-elankav-internal-token'] || '').trim();
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : internal;
  return supplied === expected
    ? { ok: true }
    : { ok: false, status: 401, code: 'ELAN_RUNTIME_UNAUTHORIZED' };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw Object.assign(new Error('Payload demasiado grande.'), { code: 'ELAN_RUNTIME_PAYLOAD_TOO_LARGE', statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON inválido.'), { code: 'ELAN_RUNTIME_INVALID_JSON', statusCode: 400 });
  }
}

async function handleElanUnifiedRuntimeApi({ req, res, sendJson }) {
  const pathname = String(req?.url || '').split('?')[0];
  if (![MANIFEST_PATH, EXECUTE_PATH].includes(pathname)) return false;

  const auth = authorized(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, code: auth.code, error: 'No autorizado para ELAN Runtime.' });
    return true;
  }

  try {
    if (pathname === MANIFEST_PATH) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Usá POST.' });
        return true;
      }
      const body = await readJson(req);
      const actor = resolveActor(body.actor || body.liveSession || {});
      sendJson(res, 200, {
        ok: true,
        runtime: 'ELAN_UNIFIED_RUNTIME',
        version: '1.0.0',
        actor,
        tools: getToolManifest(actor)
      });
      return true;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Usá POST.' });
      return true;
    }

    const body = await readJson(req);
    const execution = await executeThroughConnect({
      actor: body.actor || body.liveSession || {},
      channel: body.channel || 'api',
      tool: body.tool || body.name,
      arguments: body.arguments || {},
      conversation: body.conversation || {},
      memory: body.memory || null
    });
    sendJson(res, 200, execution);
    return true;
  } catch (error) {
    const status = Number(error?.statusCode || error?.status || 500);
    sendJson(res, status >= 400 && status < 600 ? status : 500, {
      ok: false,
      code: error?.code || 'ELAN_RUNTIME_EXECUTION_FAILED',
      error: error?.message || 'No fue posible ejecutar ELAN Runtime.'
    });
    return true;
  }
}

module.exports = {
  EXECUTE_PATH,
  MANIFEST_PATH,
  authorized,
  handleElanUnifiedRuntimeApi,
  internalToken
};
