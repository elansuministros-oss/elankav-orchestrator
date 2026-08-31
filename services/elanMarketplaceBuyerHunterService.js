'use strict';

const marketplace = require('./ownerBusinessConnectClient');
const webSearch = require('./elanMarketplaceWebSearchService');
const sourceVerification = require('./elanMarketplaceSourceVerificationService');

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

function tokens(value) {
  return sourceVerification.titleTokens(clean(value));
}

function internalDemandCompatible(offer = {}, demand = {}) {
  if (clean(offer.category) !== clean(demand.category)) return false;

  const offerSub = clean(offer.subcategory).toLowerCase();
  const demandSub = clean(demand.subcategory).toLowerCase();

  if (offerSub && demandSub && offerSub === demandSub) return true;

  const offerTokens = new Set(tokens([
    offer.title,
    offer.subcategory,
    offer.description
  ].filter(Boolean).join(' ')));

  const demandText = [
    demand.title,
    demand.subcategory,
    demand.description,
    JSON.stringify(demand.requirements || {})
  ].filter(Boolean).join(' ').toLowerCase();

  const matched = [...offerTokens].filter((token) => demandText.includes(token));
  return matched.length >= Math.min(2, Math.max(1, offerTokens.size));
}

function buyerSourceGrounded(candidate = {}, html = '') {
  const pageText = sourceVerification.stripHtml(html);
  const buyerTokens = tokens([
    candidate.buyerNeed,
    candidate.buyerName
  ].filter(Boolean).join(' '));

  if (!buyerTokens.length) return false;

  const matched = buyerTokens.filter((token) => pageText.includes(token));
  return (
    matched.length >= Math.min(2, buyerTokens.length) &&
    matched.length / buyerTokens.length >= 0.35
  );
}

async function validateWebBuyer(candidate = {}, env = process.env) {
  const sourceUrl = clean(candidate.sourceUrl);
  if (!/^https:\/\//i.test(sourceUrl)) {
    return { validated: false, code: 'BUYER_SOURCE_URL_INVALID' };
  }

  try {
    const fetched = await sourceVerification.fetchPublicHtml(sourceUrl, env);
    if (!buyerSourceGrounded(candidate, fetched.html)) {
      return {
        validated: false,
        code: 'BUYER_SOURCE_NOT_GROUNDED',
        finalUrl: fetched.finalUrl
      };
    }

    return {
      validated: true,
      code: 'BUYER_SOURCE_CONFIRMED',
      finalUrl: fetched.finalUrl,
      verifiedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      validated: false,
      code: clean(error?.code) || 'BUYER_SOURCE_VERIFY_FAILED'
    };
  }
}

function normalizeLocation(value) {
  if (!value || typeof value !== 'object') return undefined;
  const country = clean(value.country);
  if (!country) return undefined;
  return {
    country,
    ...(clean(value.department) ? { department: clean(value.department) } : {}),
    ...(clean(value.municipality) ? { municipality: clean(value.municipality) } : {}),
    ...(clean(value.locality) ? { locality: clean(value.locality) } : {})
  };
}

function normalizeConfidence(value) {
  const candidate = clean(value).toLowerCase();
  return ['low', 'medium', 'high'].includes(candidate)
    ? candidate
    : 'medium';
}

async function persistInternalDemandBuyer({
  offer,
  demand,
  env = process.env,
  persist = marketplace.marketplaceUpsertDiscoveryBuyer
}) {
  return persist({
    discoveryCode: offer.discoveryCode,
    sourceKind: 'internal_demand',
    buyerNeed: clean(demand.title || demand.description || 'Demanda compatible en CONNECT').slice(0, 5000),
    demandCode: clean(demand.demandCode || demand.id),
    confidence: internalDemandCompatible(offer, demand) ? 'high' : 'medium',
    verificationStatus: 'validated',
    ...(normalizeLocation(demand.preferredLocation || demand.location)
      ? { location: normalizeLocation(demand.preferredLocation || demand.location) }
      : {}),
    metadata: {
      buyerSearchMode: 'internal_connect_demand',
      matchedCategory: clean(offer.category),
      matchedSubcategory: clean(offer.subcategory)
    }
  }, env);
}

async function runBuyerHuntForOffer({
  offer,
  env = process.env,
  listDemands = marketplace.marketplaceListDemands,
  searchWeb = webSearch.searchPotentialBuyersForOffer,
  verifyWebBuyer = validateWebBuyer,
  persist = marketplace.marketplaceUpsertDiscoveryBuyer
} = {}) {
  if (!offer || clean(offer.kind) !== 'offer' || !clean(offer.discoveryCode)) {
    return {
      ok: false,
      state: 'OFFER_REQUIRED',
      internalCandidates: 0,
      webCandidates: 0,
      persisted: 0,
      buyers: []
    };
  }

  const buyers = [];
  let internalCandidates = 0;
  let webCandidates = 0;

  const demandsPayload = unwrap(await listDemands(env));
  const demands = Array.isArray(demandsPayload) ? demandsPayload : [];

  for (const demand of demands) {
    if (!internalDemandCompatible(offer, demand)) continue;

    const payload = await persistInternalDemandBuyer({
      offer,
      demand,
      env,
      persist
    });
    const row = unwrap(payload);
    buyers.push({
      candidateCode: clean(row?.candidateCode) || null,
      sourceKind: 'internal_demand',
      demandCode: clean(demand.demandCode || demand.id) || null
    });
    internalCandidates += 1;
  }

  const external = await searchWeb(offer, env);
  const candidates = Array.isArray(external?.buyers) ? external.buyers : [];

  for (const candidate of candidates) {
    const verification = await verifyWebBuyer(candidate, env);
    if (!verification?.validated) continue;

    const sourceUrl = clean(verification.finalUrl) || clean(candidate.sourceUrl);
    const payload = await persist({
      discoveryCode: offer.discoveryCode,
      sourceKind: 'web',
      buyerNeed: clean(candidate.buyerNeed).slice(0, 5000),
      ...(clean(candidate.buyerName)
        ? { buyerName: clean(candidate.buyerName).slice(0, 220) }
        : {}),
      ...(clean(candidate.sourceName)
        ? { sourceName: clean(candidate.sourceName).slice(0, 220) }
        : {}),
      sourceUrl,
      ...(clean(candidate.contactHint)
        ? { contactHint: clean(candidate.contactHint).slice(0, 500) }
        : {}),
      ...(normalizeLocation(candidate.location)
        ? { location: normalizeLocation(candidate.location) }
        : {}),
      confidence: normalizeConfidence(candidate.confidence),
      verificationStatus: 'validated',
      metadata: {
        buyerSearchMode: 'autonomous_web_buyer_hunter',
        sourceVerified: true,
        verifiedAt: clean(verification.verifiedAt) || new Date().toISOString()
      }
    }, env);

    const row = unwrap(payload);
    buyers.push({
      candidateCode: clean(row?.candidateCode) || null,
      sourceKind: 'web',
      sourceUrl
    });
    webCandidates += 1;
  }

  return {
    ok: true,
    state: buyers.length ? 'BUYERS_FOUND' : 'NO_BUYER_FOUND_YET',
    discoveryCode: offer.discoveryCode,
    internalCandidates,
    webCandidates,
    persisted: buyers.length,
    buyers
  };
}

async function runBuyerHunterCycle({
  env = process.env,
  listDiscoveries = marketplace.marketplaceListDiscoveries,
  listDemands = marketplace.marketplaceListDemands,
  searchWeb = webSearch.searchPotentialBuyersForOffer,
  verifyWebBuyer = validateWebBuyer,
  persist = marketplace.marketplaceUpsertDiscoveryBuyer,
  limit = 2,
  now = Date.now()
} = {}) {
  const take = Math.max(1, Math.min(5, Number(limit) || 2));
  const payload = unwrap(await listDiscoveries({
    kind: 'offer',
    limit: 100
  }, env));

  const catalog = (Array.isArray(payload) ? payload : [])
    .filter((item) =>
      clean(item.kind) === 'offer' &&
      clean(item.status) === 'active' &&
      clean(item.verificationStatus) === 'validated'
    );

  const slot = catalog.length
    ? Math.floor(Number(now) / (15 * 60 * 1000)) % catalog.length
    : 0;

  const offers = [];
  for (let offset = 0; offset < Math.min(take, catalog.length); offset += 1) {
    offers.push(catalog[(slot + offset) % catalog.length]);
  }

  const results = [];
  for (const offer of offers) {
    results.push(await runBuyerHuntForOffer({
      offer,
      env,
      listDemands,
      searchWeb,
      verifyWebBuyer,
      persist
    }));
  }

  return {
    ok: results.every((item) => item.ok),
    offersScanned: offers.length,
    buyersFound: results.reduce((sum, item) => sum + Number(item.persisted || 0), 0),
    results
  };
}

module.exports = {
  buyerSourceGrounded,
  internalDemandCompatible,
  normalizeConfidence,
  normalizeLocation,
  persistInternalDemandBuyer,
  runBuyerHuntForOffer,
  runBuyerHunterCycle,
  validateWebBuyer
};
