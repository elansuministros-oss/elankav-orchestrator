'use strict';

const CONTEXT_VERSION = 'ORCH-031B';
const OWNER_PHONE = '50588388940';

function normalizeText(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function normalizePlatform(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeChannel(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (digits.length === 8) {
    return `505${digits}`;
  }

  return digits;
}

function findMessage(value, depth = 0) {
  if (depth > 4 || value == null) return null;

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === 'object') {
    for (const key of ['message', 'text', 'content', 'prompt', 'body']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const found = findMessage(value[key], depth + 1);
        if (found) return found;
      }
    }
  }

  return null;
}

function buildContext(input = {}) {
  const args = Array.isArray(input.arguments) ? input.arguments : [];
  const phone = normalizePhone(
    input.externalUserId ||
    input.phone ||
    input.metadata?.phone
  );
  const platform = normalizePlatform(input.platform);
  const channel = normalizeChannel(input.channel);

  return Object.freeze({
    version: CONTEXT_VERSION,
    createdAt: new Date().toISOString(),
    requestId: input.requestId || null,
    source: input.source || 'messageService',
    message: input.message || findMessage(args),
    platform: platform || null,
    channel: channel || null,
    externalUserId: phone || null,
    owner: Object.freeze({
      isOwner: phone === OWNER_PHONE,
      phone: phone || null
    }),
    command: null,
    business: null,
    memory: null,
    metadata: Object.freeze({
      argumentCount: args.length,
      transparentMode: true,
      ...(input.metadata && typeof input.metadata === 'object'
        ? input.metadata
        : {})
    })
  });
}

module.exports = {
  CONTEXT_VERSION,
  OWNER_PHONE,
  buildContext,
  findMessage,
  normalizePlatform,
  normalizeChannel,
  normalizePhone
};
