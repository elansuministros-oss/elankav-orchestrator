'use strict';

const {
  fetchCommercialOffer
} = require('../adapters/commercialLibraryAdapter');
const {
  loadPlatformKnowledgeSafely,
  normalizePlatform
} = require('./connectPlatformKnowledgeService');

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

function resolveKnowledgePlatform(platform) {
  return normalizePlatform(
    platform ||
    process.env.WAHA_DEFAULT_PLATFORM ||
    process.env.ELAN_AI_DEFAULT_PLATFORM ||
    'ELANVISUAL'
  );
}

async function loadCommercialContext(
  { message, history, platform } = {},
  {
    fetchOffer = fetchCommercialOffer,
    loadKnowledge = loadPlatformKnowledgeSafely
  } = {}
) {
  const lookupText = buildCommercialLookupText({ message, history });
  const resolvedPlatform = resolveKnowledgePlatform(platform);

  const [offerResult, platformKnowledge] = await Promise.all([
    Promise.resolve()
      .then(() => fetchOffer(lookupText))
      .catch(() => null),
    Promise.resolve()
      .then(() => loadKnowledge({
        platform: resolvedPlatform,
        query: lookupText
      }))
      .catch(() => null)
  ]);

  const offer = offerResult || null;
  const knowledgeAvailable = Boolean(
    platformKnowledge?.available &&
    platformKnowledge?.payload
  );

  if (!offer && !knowledgeAvailable) return null;

  return Object.freeze({
    available: true,
    source: offer?.source || 'ELANKAV CONNECT',
    productId: offer?.productId || null,
    productName: offer?.productName || null,
    description: offer?.description || null,
    specifications: offer?.specifications || offer?.dimensions || null,
    priceOffers: Array.isArray(offer?.priceOffers)
      ? offer.priceOffers
      : [],
    variants: Array.isArray(offer?.variants)
      ? offer.variants
      : [],
    salesGuidance: offer?.salesGuidance || null,
    commercialRules: offer?.commercialRules || null,
    platformKnowledge: knowledgeAvailable
      ? Object.freeze({
          source: platformKnowledge.source || 'ELANKAV_CONNECT',
          policy: platformKnowledge.policy || 'approved-commercial-catalogs-only',
          platformId: platformKnowledge.platformId || resolvedPlatform,
          query: platformKnowledge.query || lookupText,
          payload: platformKnowledge.payload
        })
      : null
  });
}

module.exports = {
  MAX_COMMERCIAL_HISTORY_MESSAGES,
  buildCommercialLookupText,
  resolveKnowledgePlatform,
  loadCommercialContext
};