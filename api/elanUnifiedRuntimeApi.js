'use strict';

const { getToolManifest } = require('../services/elanUnifiedToolRegistry');
const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');
const {
  executeThroughConnect,
  loadConversationMemory,
  persistUnifiedContext,
  resolveActor
} = require('../services/elanUnifiedRuntimeService');

const MANIFEST_PATH = '/api/v1/elan-runtime/tools';
const EXECUTE_PATH = '/api/v1/elan-runtime/execute';
const MEMORY_EVENT_PATH = '/api/v1/elan-runtime/memory/event';
const FIELD_MEDIA_PATH = '/api/v1/elan-runtime/field/media';

function internalTokens(env = process.env) {
  return [
    env.ORCHESTRATOR_INTERNAL_TOKEN,
    env.ELANKAV_ORCHESTRATOR_INTERNAL_TOKEN,
    env.CONNECT_INTERNAL_TOKEN,
    env.VQS_API_TOKEN
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function internalToken(env = process.env) {
  return internalTokens(env)[0] || '';
}

function authorized(req, env = process.env) {
  const expected = internalTokens(env);
  if (!expected.length) return { ok: false, status: 503, code: 'ELAN_RUNTIME_AUTH_NOT_CONFIGURED' };
  const authorization = String(req?.headers?.authorization || '').trim();
  const internal = String(req?.headers?.['x-elankav-internal-token'] || '').trim();
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : internal;
  return supplied && expected.includes(supplied)
    ? { ok: true }
    : { ok: false, status: 401, code: 'ELAN_RUNTIME_UNAUTHORIZED' };
}

async function readJson(req, maxBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Payload demasiado grande.'), { code: 'ELAN_RUNTIME_PAYLOAD_TOO_LARGE', statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON inválido.'), { code: 'ELAN_RUNTIME_INVALID_JSON', statusCode: 400 });
  }
}

function actorPhone(actor = {}) {
  return String(actor.canonicalPhone || actor.phone || '').replace(/\D/g, '');
}

function canUseFieldCamera(actor = {}) {
  if (String(actor.role || '').toLowerCase() === 'owner' || String(actor.authority || '').toLowerCase() === 'owner_identity') return true;
  const scopes = Array.isArray(actor.scopes) ? actor.scopes.map((value) => String(value)) : [];
  return scopes.includes('*') || scopes.includes('camera.vision');
}

function shouldMirrorCopilotNote({ channel, direction, text, messageType } = {}) {
  if (String(channel || '').toLowerCase() !== 'copilot') return false;
  if (String(direction || '').toLowerCase() !== 'inbound') return false;
  if (!['text', 'audio', 'field_note'].includes(String(messageType || 'text').toLowerCase())) return false;
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  if (/^Analiz[aá] esta captura de campo/i.test(normalized)) return false;
  if (/^Captura de campo guardada desde ELAN Copiloto\.?$/i.test(normalized)) return false;
  return true;
}

function fieldNoteText(body = {}) {
  const source = String(body.messageType || 'text').toLowerCase() === 'audio' ? '🎙️ Voz' : '⌨️ Texto';
  return [
    '📝 ELAN Copiloto · Nota de campo',
    source,
    '',
    String(body.text || '').trim()
  ].join('\n');
}

async function mirrorCopilotNoteToWhatsApp({ actor, body }) {
  if (!shouldMirrorCopilotNote(body)) return null;
  const phone = actorPhone(actor);
  if (!phone) {
    throw Object.assign(new Error('El usuario no tiene teléfono canónico para guardar notas en WhatsApp.'), {
      code: 'ELAN_FIELD_PHONE_REQUIRED',
      statusCode: 409
    });
  }
  const delivery = createWahaDeliveryAdapter();
  return delivery.sendText({ phone, text: fieldNoteText(body) });
}

async function deliverFieldCapture({ actor, body }) {
  if (!canUseFieldCamera(actor)) {
    throw Object.assign(new Error('El actor no tiene permiso de cámara.'), {
      code: 'ELAN_FIELD_CAMERA_FORBIDDEN',
      statusCode: 403
    });
  }
  const phone = actorPhone(actor);
  if (!phone) {
    throw Object.assign(new Error('El usuario no tiene teléfono canónico para guardar capturas en WhatsApp.'), {
      code: 'ELAN_FIELD_PHONE_REQUIRED',
      statusCode: 409
    });
  }
  const dataUrl = String(body.dataUrl || '').trim();
  const mimeType = String(body.mimeType || '').trim().toLowerCase();
  if (!dataUrl || !mimeType.startsWith('image/')) {
    throw Object.assign(new Error('Captura de campo inválida.'), {
      code: 'ELAN_FIELD_IMAGE_REQUIRED',
      statusCode: 400
    });
  }

  const delivery = createWahaDeliveryAdapter();
  const sent = await delivery.sendImageData({
    phone,
    data: dataUrl,
    mimeType,
    fileName: String(body.fileName || 'captura-campo.jpg').trim() || 'captura-campo.jpg',
    caption: String(body.caption || '📸 ELAN Copiloto · Captura de campo').trim()
  });

  const note = String(body.note || 'Captura de campo guardada desde ELAN Copiloto.').trim();
  const memory = await persistUnifiedContext({
    actor,
    platform: String(body.platform || 'ELANVISUAL').toUpperCase(),
    channel: 'copilot',
    direction: 'inbound',
    text: note,
    messageType: 'image',
    externalMessageId: body.externalMessageId || sent.messageId || null
  });

  return { sent, memory };
}

async function handleElanUnifiedRuntimeApi({ req, res, sendJson }) {
  const pathname = String(req?.url || '').split('?')[0];
  if (![MANIFEST_PATH, EXECUTE_PATH, MEMORY_EVENT_PATH, FIELD_MEDIA_PATH].includes(pathname)) return false;

  const auth = authorized(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, code: auth.code, error: 'No autorizado para ELAN Runtime.' });
    return true;
  }

  try {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Usá POST.' });
      return true;
    }

    const body = await readJson(req, pathname === FIELD_MEDIA_PATH ? 24 * 1024 * 1024 : 256 * 1024);
    const actor = resolveActor(body.actor || body.liveSession || {});
    const platform = String(body.platform || 'ELANVISUAL').toUpperCase();

    if (pathname === MANIFEST_PATH) {
      const memory = await loadConversationMemory({
        actor,
        platform,
        limit: Math.max(1, Math.min(Number(body.memoryLimit) || 20, 50))
      });
      sendJson(res, 200, {
        ok: true,
        runtime: 'ELAN_UNIFIED_RUNTIME',
        version: '1.0.0',
        authority: 'CONNECT',
        actor,
        memory,
        tools: getToolManifest(actor)
      });
      return true;
    }

    if (pathname === MEMORY_EVENT_PATH) {
      const direction = String(body.direction || '').toLowerCase();
      if (!['inbound', 'outbound'].includes(direction)) {
        sendJson(res, 400, { ok: false, code: 'ELAN_RUNTIME_DIRECTION_REQUIRED', error: 'direction debe ser inbound u outbound.' });
        return true;
      }
      const result = await persistUnifiedContext({
        actor,
        platform,
        channel: body.channel || 'api',
        direction,
        text: body.text,
        messageType: body.messageType || 'text',
        externalMessageId: body.externalMessageId || null,
        occurredAt: body.occurredAt || null
      });
      const mirrored = await mirrorCopilotNoteToWhatsApp({
        actor,
        body: {
          channel: body.channel || 'api',
          direction,
          text: body.text,
          messageType: body.messageType || 'text'
        }
      });
      sendJson(res, result?.duplicate ? 200 : 201, {
        ok: true,
        runtime: 'ELAN_UNIFIED_RUNTIME',
        version: '1.0.0',
        authority: 'CONNECT',
        actor,
        memory: result,
        whatsapp: mirrored ? { chatId: mirrored.chatId, messageId: mirrored.messageId || null } : null
      });
      return true;
    }

    if (pathname === FIELD_MEDIA_PATH) {
      const result = await deliverFieldCapture({ actor, body: { ...body, platform } });
      sendJson(res, 201, {
        ok: true,
        runtime: 'ELAN_UNIFIED_RUNTIME',
        version: '1.0.0',
        authority: 'CONNECT',
        actor,
        delivery: {
          chatId: result.sent.chatId,
          messageId: result.sent.messageId || null
        },
        memory: result.memory
      });
      return true;
    }

    const execution = await executeThroughConnect({
      actor,
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
  MEMORY_EVENT_PATH,
  FIELD_MEDIA_PATH,
  authorized,
  handleElanUnifiedRuntimeApi,
  internalToken,
  internalTokens
};