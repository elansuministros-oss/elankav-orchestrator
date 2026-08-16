'use strict';

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameNumber(left, right, tolerance = 0.0001) {
  const a = normalizeNumber(left);
  const b = normalizeNumber(right);
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= tolerance;
}

function matchesAuthorization(authorization = {}, quote = {}) {
  if (String(authorization.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return false;

  if (authorization.sellerId && normalizeText(authorization.sellerId) !== normalizeText(quote.sellerId)) return false;
  if (authorization.customerId && String(authorization.customerId) !== String(quote.customerId || '')) return false;

  const authorizationProduct = authorization.productKey || authorization.productDescription || authorization.product;
  const quoteProduct = quote.productKey || quote.productDescription || quote.product;
  if (authorizationProduct && normalizeText(authorizationProduct) !== normalizeText(quoteProduct)) return false;

  if (authorization.destination && normalizeText(authorization.destination) !== normalizeText(quote.destination)) return false;
  if (authorization.width != null && !sameNumber(authorization.width, quote.width)) return false;
  if (authorization.height != null && !sameNumber(authorization.height, quote.height)) return false;
  if (authorization.quantity != null && Number(authorization.quantity) !== Number(quote.quantity)) return false;

  if (authorization.validFrom && new Date(quote.quotedAt || Date.now()) < new Date(authorization.validFrom)) return false;
  if (authorization.validUntil && new Date(quote.quotedAt || Date.now()) > new Date(authorization.validUntil)) return false;
  if (authorization.remainingUses != null && Number(authorization.remainingUses) <= 0) return false;

  return true;
}

function resolveAuthorizedPrice({ role, manualPrice, quote = {}, authorizations = [], officialPrice = null } = {}) {
  const normalizedRole = String(role || '').trim().toUpperCase();

  if (normalizedRole === 'OWNER' && normalizeNumber(manualPrice) !== null) {
    return Object.freeze({
      allowed: true,
      price: normalizeNumber(manualPrice),
      source: 'OWNER_DIRECT_PRICE',
      authorizationId: null
    });
  }

  const matchingAuthorization = authorizations.find(item => matchesAuthorization(item, quote));
  if (matchingAuthorization) {
    return Object.freeze({
      allowed: true,
      price: normalizeNumber(matchingAuthorization.price),
      source: 'OWNER_PRICE_AUTHORIZATION',
      authorizationId: matchingAuthorization.id || null
    });
  }

  if (normalizeNumber(manualPrice) !== null && normalizedRole !== 'OWNER') {
    return Object.freeze({
      allowed: false,
      price: normalizeNumber(officialPrice),
      source: normalizeNumber(officialPrice) !== null ? 'OFFICIAL_PRICE' : 'PRICE_REQUIRED',
      reason: 'SELLER_MANUAL_PRICE_NOT_ALLOWED',
      authorizationId: null
    });
  }

  return Object.freeze({
    allowed: normalizeNumber(officialPrice) !== null,
    price: normalizeNumber(officialPrice),
    source: normalizeNumber(officialPrice) !== null ? 'OFFICIAL_PRICE' : 'PRICE_REQUIRED',
    authorizationId: null
  });
}

module.exports = {
  matchesAuthorization,
  resolveAuthorizedPrice
};
