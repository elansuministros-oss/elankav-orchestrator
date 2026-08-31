'use strict';

const marketplace = require('./ownerBusinessConnectClient');
const {
  createWahaDeliveryAdapter,
  normalizePhone
} = require('../adapters/wahaDeliveryAdapter');

function clean(value) {
  return String(value || '').trim();
}

function unwrap(payload) {
  if (
    payload &&
    typeof payload === 'object' &&
    Object.prototype.hasOwnProperty.call(payload, 'result')
  ) {
    return payload.result;
  }
  return payload;
}

function sellerNegotiationMessage(discovery = {}) {
  const title = clean(discovery.title) || 'la publicación';
  return [
    'Hola. Soy ELAN, una IA intermediaria de ELAN GO.',
    '',
    `Tengo un cliente interesado en ${title}.`,
    'Quiero confirmar si sigue disponible y trabajar la operación como intermediario.',
    '',
    '¿Qué precio neto o comisión puede autorizarnos para manejar la venta?',
    '',
    'No compartimos los datos del comprador hasta avanzar la negociación.'
  ].join('\n');
}

async function exactDiscovery(discoveryCode, env) {
  const payload = await marketplace.marketplaceListDiscoveries(
    { search: discoveryCode, limit: 10 },
    env
  );
  const items = unwrap(payload);
  const list = Array.isArray(items) ? items : [];
  return list.find((item) => clean(item.discoveryCode) === discoveryCode) || null;
}

async function processOneInterest({
  interest,
  env = process.env,
  delivery
}) {
  const inquiryCode = clean(interest.inquiryCode);
  const discoveryCode = clean(interest.discoveryCode);

  if (!inquiryCode || !discoveryCode) {
    return { ok: false, state: 'INVALID_INTEREST', inquiryCode };
  }

  const discovery = await exactDiscovery(discoveryCode, env);
  if (!discovery) {
    await marketplace.marketplaceUpdateDiscoveryInterest({
      inquiryCode,
      status: 'failed',
      lastError: 'DISCOVERY_NOT_FOUND'
    }, env);
    return { ok: false, state: 'DISCOVERY_NOT_FOUND', inquiryCode };
  }

  const sellerPhone = normalizePhone(clean(discovery.contactHint));
  if (!sellerPhone) {
    await marketplace.marketplaceUpdateDiscoveryInterest({
      inquiryCode,
      status: 'contact_unavailable',
      lastError: 'SELLER_PHONE_NOT_AVAILABLE'
    }, env);
    return {
      ok: false,
      state: 'SELLER_CONTACT_UNAVAILABLE',
      inquiryCode,
      discoveryCode
    };
  }

  await marketplace.marketplaceUpdateDiscoveryInterest({
    inquiryCode,
    status: 'contacting_seller',
    lastError: null
  }, env);

  const adapter = delivery || createWahaDeliveryAdapter();
  const sent = await adapter.sendText({
    phone: sellerPhone,
    text: sellerNegotiationMessage(discovery)
  });

  await marketplace.marketplaceUpdateDiscoveryInterest({
    inquiryCode,
    status: 'seller_contacted',
    lastError: null
  }, env);

  return {
    ok: true,
    state: 'SELLER_CONTACTED',
    inquiryCode,
    discoveryCode,
    sellerPhone,
    chatId: sent.chatId,
    messageId: sent.messageId || null
  };
}

async function processPendingDiscoveryInterests({
  env = process.env,
  delivery,
  limit = 3
} = {}) {
  const payload = await marketplace.marketplaceListDiscoveryInterests(
    { status: 'received', limit: Math.max(1, Math.min(10, Number(limit) || 3)) },
    env
  );

  const items = unwrap(payload);
  const interests = Array.isArray(items) ? items : [];
  const results = [];

  for (const interest of interests) {
    try {
      results.push(await processOneInterest({
        interest,
        env,
        delivery
      }));
    } catch (error) {
      const inquiryCode = clean(interest?.inquiryCode);
      if (inquiryCode) {
        try {
          await marketplace.marketplaceUpdateDiscoveryInterest({
            inquiryCode,
            status: 'failed',
            lastError: clean(error?.code || error?.message || 'SELLER_OUTREACH_FAILED').slice(0, 1000)
          }, env);
        } catch {}
      }
      results.push({
        ok: false,
        state: 'SELLER_OUTREACH_FAILED',
        inquiryCode,
        code: clean(error?.code) || 'SELLER_OUTREACH_FAILED'
      });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    processed: results.length,
    contacted: results.filter((item) => item.state === 'SELLER_CONTACTED').length,
    results
  };
}

module.exports = {
  exactDiscovery,
  processOneInterest,
  processPendingDiscoveryInterests,
  sellerNegotiationMessage
};
