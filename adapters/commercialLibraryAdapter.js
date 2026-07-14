'use strict';

const DEFAULT_COMMERCIAL_LIBRARY_URL =
  'https://elankav-core.vercel.app/api/commercial-library';
const DEFAULT_TIMEOUT_MS = 15000;

function failure(status, extra = {}) {
  return {
    ok: false,
    status,
    offer: null,
    ...extra
  };
}

function normalizeBaseUrl(value) {
  return String(value || '').trim();
}

function isValidOffer(offer, productId) {
  const requiredVariantIds = new Set([
    'boton-transparente',
    'boton-con-impresion',
    'boton-impresion-uv-premium',
    'boton-premium-combinado'
  ]);
  const numericRules = [
    offer?.effectiveSizeCm,
    offer?.dimensions?.baseCm,
    offer?.dimensions?.maxStandardCm,
    offer?.materialRules?.thicknessMm,
    offer?.pricingRule?.incrementAmount,
    offer?.commercialRules?.paymentAdvancePercent,
    offer?.commercialRules?.paymentBalancePercent
  ].map(Number);

  if (
    !offer ||
    offer.status !== 'active' ||
    offer.source !== 'ELANKAV Commercial Library' ||
    offer.productId !== productId ||
    !Array.isArray(offer.variants) ||
    offer.variants.length !== requiredVariantIds.size ||
    offer.pricingRule?.currency !== 'USD' ||
    numericRules.some(value => !Number.isFinite(value) || value <= 0) ||
    Number(offer.commercialRules.paymentAdvancePercent) +
      Number(offer.commercialRules.paymentBalancePercent) !== 100
  ) {
    return false;
  }

  return offer.variants.every(variant => {
    const quote = variant?.quote;

    if (
      !requiredVariantIds.has(variant?.id) ||
      !variant?.name ||
      !quote ||
      !['priced', 'manual-review'].includes(quote.status)
    ) {
      return false;
    }

    if (quote.status === 'priced') {
      return (
        quote.currency === 'USD' &&
        Number.isFinite(Number(quote.total)) &&
        Number(quote.total) >= 0
      );
    }

    return quote.currency === 'USD';
  });
}

async function fetchCommercialOffer(
  { productId, sizeCm } = {},
  options = {}
) {
  const normalizedProductId = String(productId || '').trim();

  if (!normalizedProductId) {
    return failure('COMMERCIAL_PRODUCT_ID_REQUIRED');
  }

  const baseUrl = normalizeBaseUrl(
    options.url ||
    process.env.COMMERCIAL_LIBRARY_URL ||
    DEFAULT_COMMERCIAL_LIBRARY_URL
  );

  let url;

  try {
    url = new URL(baseUrl);

    if (url.protocol !== 'https:') {
      return failure('COMMERCIAL_LIBRARY_URL_INVALID');
    }

    url.searchParams.set('productId', normalizedProductId);

    if (
      sizeCm !== undefined &&
      sizeCm !== null &&
      String(sizeCm).trim() !== ''
    ) {
      url.searchParams.set('sizeCm', String(sizeCm));
    }
  } catch {
    return failure('COMMERCIAL_LIBRARY_URL_INVALID');
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    return failure('COMMERCIAL_LIBRARY_FETCH_UNAVAILABLE');
  }

  let response;

  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(
        Number(options.timeoutMs) > 0
          ? Number(options.timeoutMs)
          : DEFAULT_TIMEOUT_MS
      )
    });
  } catch (error) {
    return failure(
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError'
        ? 'COMMERCIAL_LIBRARY_TIMEOUT'
        : 'COMMERCIAL_LIBRARY_UNAVAILABLE'
    );
  }

  let payload;

  try {
    payload = await response.json();
  } catch {
    return failure('COMMERCIAL_LIBRARY_INVALID_RESPONSE');
  }

  if (!response.ok || payload?.success !== true) {
    return failure('COMMERCIAL_LIBRARY_HTTP_ERROR', {
      httpStatus: response.status || 500,
      providerError: payload?.error || null
    });
  }

  if (!isValidOffer(payload.result, normalizedProductId)) {
    return failure('COMMERCIAL_LIBRARY_INVALID_OFFER');
  }

  return {
    ok: true,
    status: 'COMMERCIAL_OFFER_READY',
    offer: payload.result
  };
}

module.exports = {
  DEFAULT_COMMERCIAL_LIBRARY_URL,
  fetchCommercialOffer,
  isValidOffer
};
