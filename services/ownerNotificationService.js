'use strict';

const { createWahaDeliveryAdapter, normalizePhone } = require('../adapters/wahaDeliveryAdapter');

const DEFAULT_OWNER_PHONE = '50588388940';

function ownerPhones(env = process.env) {
  const configured = String(env.ORCHESTRATOR_OWNER_PHONES || env.ORCHESTRATOR_OWNER_PHONE || '')
    .split(',')
    .map(normalizePhone)
    .filter(Boolean);
  return configured.length ? [...new Set(configured)] : [DEFAULT_OWNER_PHONE];
}

function isOwnerPhone(value, env = process.env) {
  const phone = normalizePhone(value);
  return Boolean(phone && ownerPhones(env).includes(phone));
}

async function notifyOwner(text, {
  delivery = createWahaDeliveryAdapter(),
  env = process.env
} = {}) {
  const message = String(text || '').trim();
  if (!message) return [];
  const results = [];
  for (const phone of ownerPhones(env)) {
    const sent = await delivery.sendText({ phone, text: message });
    results.push({ phone, chatId: sent?.chatId || null, messageId: sent?.messageId || null });
  }
  return results;
}

module.exports = {
  DEFAULT_OWNER_PHONE,
  isOwnerPhone,
  notifyOwner,
  ownerPhones
};
