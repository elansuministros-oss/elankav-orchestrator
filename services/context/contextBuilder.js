'use strict';

const {
  resolveCanonicalIdentity
} = require('./identityResolver');
const {
  resolvePlatform
} = require('./platformResolver');

const CONTEXT_VERSION = 'ORCH-039';
const DEFAULT_OWNER_PHONES = Object.freeze([
  '50588388940'
]);

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
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase().endsWith('@lid')) return '';
  const digits = raw.replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (digits.length === 8) {
    return `505${digits}`;
  }

  return digits;
}

function normalizePhoneList(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  return [...new Set(
    source
      .map(normalizePhone)
      .filter(Boolean)
  )];
}

function getOwnerPhones() {
  const configured =
    process.env.ORCHESTRATOR_OWNER_PHONES ||
    process.env.ORCHESTRATOR_OWNER_PHONE ||
    '';

  const phones = normalizePhoneList(configured);

  return Object.freeze(
    phones.length ? phones : [...DEFAULT_OWNER_PHONES]
  );
}

function getOwnerPhone() {
  return getOwnerPhones()[0] || '';
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
  const receivedIdentity =
    input.externalUserId ||
    input.phone ||
    input.metadata?.senderRaw ||
    input.metadata?.chatId ||
    input.metadata?.phone;
  const identity = resolveCanonicalIdentity(receivedIdentity);
  const directPhone = normalizePhone(input.phone || input.metadata?.phone);
  const aliasPhone = identity.matchedAlias ? normalizePhone(identity.canonicalId) : '';
  const phone = aliasPhone || directPhone;
  const ownerPhones = getOwnerPhones();
  const message = input.message || findMessage(args);
  const platformResolution = resolvePlatform({
    platform: input.platform,
    message,
    metadata: input.metadata
  });
  const channel = normalizeChannel(input.channel);
  const rawIdentity = normalizeText(receivedIdentity);

  return Object.freeze({
    version: CONTEXT_VERSION,
    createdAt: new Date().toISOString(),
    requestId: input.requestId || null,
    source: input.source || 'messageService',
    message,
    platform: platformResolution.platform,
    channel: channel || null,
    externalUserId: rawIdentity || null,
    phone: phone || rawIdentity || null,
    owner: Object.freeze({
      isOwner: Boolean(phone && ownerPhones.includes(phone)),
      phone: phone || null
    }),
    identity: Object.freeze({
      receivedId: rawIdentity || identity.receivedId,
      canonicalId: phone || identity.canonicalId || null,
      matchedAlias: identity.matchedAlias,
      source: identity.source
    }),
    command: null,
    business: null,
    memory: null,
    metadata: Object.freeze({
      argumentCount: args.length,
      transparentMode: true,
      identityReceivedId: rawIdentity || identity.receivedId,
      identityCanonicalId: phone || identity.canonicalId || null,
      identityMatchedAlias: identity.matchedAlias,
      identitySource: identity.source,
      platformResolution: Object.freeze({
        source: platformResolution.source,
        matchedAlias: platformResolution.matchedAlias,
        confidence: platformResolution.confidence,
        receivedPlatform: normalizePlatform(input.platform) || null
      }),
      ...(input.metadata && typeof input.metadata === 'object'
        ? input.metadata
        : {})
    })
  });
}

module.exports = {
  CONTEXT_VERSION,
  DEFAULT_OWNER_PHONES,
  getOwnerPhone,
  getOwnerPhones,
  buildContext,
  findMessage,
  normalizePlatform,
  normalizeChannel,
  normalizePhone,
  normalizePhoneList
};
