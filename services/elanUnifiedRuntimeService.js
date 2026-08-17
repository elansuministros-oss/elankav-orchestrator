'use strict';

const { resolveCanonicalIdentity } = require('./context/identityResolver');
const { executeTool, getToolManifest } = require('./elanUnifiedToolRegistry');
const { readUnifiedMemory, publishUnifiedMemoryEvent, publishUnifiedMemoryEventSafely } = require('./connectConversationClient');

function normalizeScopes(scopes, role) {
  const values = Array.isArray(scopes) ? scopes.map(value => String(value).trim()).filter(Boolean) : [];
  if (String(role || '').toLowerCase() === 'owner' && !values.includes('*')) values.push('*');
  return [...new Set(values)];
}

function resolveActor(input = {}) {
  const role = String(input.role || '').trim().toLowerCase() || 'unknown';
  const identity = resolveCanonicalIdentity(input.phone || input.canonicalPhone || input.actorId || input.sub || '');
  const owner = role === 'owner' || String(input.authority || '').toLowerCase() === 'owner_identity';
  return Object.freeze({
    role: owner ? 'owner' : role,
    actorId: owner ? 'owner' : (String(input.actorId || input.sub || identity.canonicalId || '').trim() || null),
    registered: input.registered !== false,
    platformAllowed: input.platformAllowed !== false,
    platforms: Array.isArray(input.platforms) ? input.platforms : (owner ? ['*'] : []),
    scopes: normalizeScopes(input.scopes, owner ? 'owner' : role),
    authority: owner ? 'owner_identity' : (String(input.authority || '').trim() || null),
    phone: identity.receivedId || null,
    canonicalPhone: identity.canonicalId || null
  });
}

function actorMemoryKey(actor = {}) {
  const resolved = resolveActor(actor);
  return String(resolved.actorId || resolved.canonicalPhone || resolved.phone || '').trim() || null;
}

function loadUnifiedContext({ actor: actorInput = {}, channel = 'unknown', conversation = {}, memory = null } = {}) {
  const actor = resolveActor(actorInput);
  return Object.freeze({
    runtime: 'ELAN_UNIFIED_RUNTIME',
    version: '1.0.0',
    channel: String(channel || 'unknown').trim().toLowerCase(),
    actor,
    actorKey: actorMemoryKey(actor),
    conversation: conversation && typeof conversation === 'object' ? conversation : {},
    memory: memory && typeof memory === 'object' ? memory : null,
    tools: getToolManifest(actor)
  });
}

async function loadConversationMemory({ actor, platform = 'ELANVISUAL', limit = 20, env = process.env } = {}) {
  const resolved = resolveActor(actor || {});
  const actorKey = actorMemoryKey(resolved);
  if (!actorKey) return { actorKey: null, conversationId: null, history: [] };
  const payload = await readUnifiedMemory({
    actorKey,
    actorRole: resolved.role,
    platform: String(platform || 'ELANVISUAL').toUpperCase(),
    limit
  }, { env });
  return {
    actorKey,
    conversationId: payload?.conversationId || null,
    history: Array.isArray(payload?.history) ? payload.history : []
  };
}

async function persistUnifiedContext({ actor, platform = 'ELANVISUAL', channel = 'unknown', direction, text, messageType = 'text', externalMessageId, occurredAt, env = process.env, safe = false } = {}) {
  const resolved = resolveActor(actor || {});
  const actorKey = actorMemoryKey(resolved);
  const content = String(text || '').trim();
  if (!actorKey || !content) return { ok: false, skipped: true, reason: !actorKey ? 'actor_key_missing' : 'text_missing' };
  const event = {
    actorKey,
    actorRole: resolved.role,
    platform: String(platform || 'ELANVISUAL').toUpperCase(),
    sourceChannel: String(channel || 'unknown').toLowerCase(),
    direction,
    text: content,
    messageType,
    externalMessageId: externalMessageId || undefined,
    occurredAt: occurredAt || undefined
  };
  if (safe) return publishUnifiedMemoryEventSafely(event, { env });
  return publishUnifiedMemoryEvent(event, { env });
}

function unwrapConnectPayload(payload) {
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')) return payload.data;
  return payload;
}

async function executeThroughConnect({ actor, channel, tool, arguments: args, conversation, memory, env = process.env } = {}) {
  const context = loadUnifiedContext({ actor, channel, conversation, memory });
  const raw = await executeTool({ actor: context.actor, tool, arguments: args, env });
  return {
    ok: true,
    runtime: context.runtime,
    version: context.version,
    channel: context.channel,
    actor: context.actor,
    actorKey: context.actorKey,
    tool,
    authority: 'CONNECT',
    result: unwrapConnectPayload(raw)
  };
}

function formatAuthorizedPriceResult(execution) {
  const data = execution?.result || {};
  const status = String(data.status || '').toUpperCase();
  if (status === 'MULTIPLE') {
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const names = matches.map(item => item?.name || item?.code).filter(Boolean);
    return names.length
      ? `Encontré varias tarifas autorizadas que coinciden: ${names.join('; ')}. Decime cuál variante, medida o acabado querés consultar.`
      : 'Encontré más de una coincidencia autorizada. Necesito la variante, medida o acabado antes de darte un precio.';
  }
  if (status === 'BASE_PRICE_ONLY') {
    const item = data.item || {};
    const value = Number(item.minimumPrice);
    const amount = Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, '') : null;
    const currency = String(item.currency || 'USD').toUpperCase();
    if (!amount) return 'Existe una tarifa autorizada DESDE, pero CONNECT no devolvió un importe válido para comunicar.';
    return `${item.name || data.query}: DESDE ${currency} ${amount}. Es una tarifa mínima autorizada y requiere cotización final.`;
  }
  if (status === 'FOUND') {
    const item = data.item || {};
    const calculation = data.calculation || {};
    const value = Number(item.unitPrice ?? calculation.subtotal);
    const amount = Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, '') : null;
    const currency = String(calculation.currency || item.currency || 'USD').toUpperCase();
    if (!amount) return 'CONNECT encontró el producto autorizado, pero no devolvió un importe válido para comunicar.';
    return `${item.name || data.query}: ${currency} ${amount}${calculation.quantity > 1 && calculation.subtotal ? ` por unidad; subtotal ${currency} ${Number(calculation.subtotal).toFixed(2)}` : ''}. Precio verificado en la autoridad comercial de CONNECT.`;
  }
  if (status === 'REQUIRES_INPUT') {
    const missing = Array.isArray(data.missing) ? data.missing : [];
    const translated = missing.map(value => value === 'width' ? 'ancho' : value === 'height' ? 'alto' : value);
    return `La tarifa existe, pero necesito ${translated.join(' y ') || 'más datos de medida'} para resolver el precio autorizado.`;
  }
  if (status === 'PRICE_NOT_AVAILABLE') {
    return 'El producto coincide con una tarifa autorizada, pero CONNECT no permite calcular un precio automático para esos datos. Debe cotizarse sin inventar el valor.';
  }
  return `No encontré un precio comercial autorizado y publicado para “${data.query || 'esa búsqueda'}”.`;
}

module.exports = {
  actorMemoryKey,
  executeThroughConnect,
  formatAuthorizedPriceResult,
  loadConversationMemory,
  loadUnifiedContext,
  persistUnifiedContext,
  resolveActor,
  unwrapConnectPayload
};