'use strict';

const {
  fetchCommercialOffer
} = require('../adapters/commercialLibraryAdapter');

const MAX_COMMERCIAL_HISTORY_MESSAGES = 4;

function buildCommercialLookupText({ message, history } = {}) {
  const previousUserMessages = Array.isArray(history)
    ? history
        .filter(item => item?.role === 'user')
        .slice(-MAX_COMMERCIAL_HISTORY_MESSAGES)
        .map(item => String(item.content || '').trim())
        .filter(Boolean)
    : [];

  return [...previousUserMessages, String(message || '').trim()]
    .filter(Boolean)
    .join('\n');
}

async function loadCommercialContext(
  { message, history } = {},
  { fetchOffer = fetchCommercialOffer } = {}
) {
  try {
    const offer = await fetchOffer(
      buildCommercialLookupText({ message, history })
    );

    if (!offer) return null;

    return Object.freeze({
      available: true,
      source: offer.source || 'ELANKAV Commercial Library',
      productId: offer.productId,
      productName: offer.productName,
      description: offer.description,
      specifications: offer.specifications || offer.dimensions || null,
      priceOffers: Array.isArray(offer.priceOffers)
        ? offer.priceOffers
        : [],
      variants: Array.isArray(offer.variants)
        ? offer.variants
        : [],
      salesGuidance: offer.salesGuidance || null,
      commercialRules: offer.commercialRules || null
    });
  } catch {
    return null;
  }
}

module.exports = {
  MAX_COMMERCIAL_HISTORY_MESSAGES,
  buildCommercialLookupText,
  loadCommercialContext
};
