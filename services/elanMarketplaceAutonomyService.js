'use strict';

const marketplace = require('./ownerBusinessConnectClient');
const webSearch = require('./elanMarketplaceWebSearchService');

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

function inferContactMethod(candidate = {}) {
  const value = clean(candidate.contact).toLowerCase();
  if (!value) return null;
  if (/whatsapp|wa\.me|api\.whatsapp/.test(value)) return 'whatsapp';
  if (/^[+\d\s().-]{7,}$/.test(value)) return 'phone';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  if (/form|contact|contacto/.test(value)) return 'web_form';
  return 'platform_message';
}

function normalizeCandidate(candidate = {}) {
  const confidence = ['high', 'medium', 'low'].includes(clean(candidate.confidence).toLowerCase())
    ? clean(candidate.confidence).toLowerCase()
    : 'low';
  const currency = ['USD', 'NIO'].includes(clean(candidate.priceCurrency).toUpperCase())
    ? clean(candidate.priceCurrency).toUpperCase()
    : null;
  const amount = Number(candidate.priceAmount);

  return {
    title: clean(candidate.title) || 'Oferta encontrada',
    providerName: clean(candidate.providerName) || null,
    summary: clean(candidate.summary),
    sourceUrl: clean(candidate.sourceUrl),
    priceAmount: Number.isFinite(amount) && amount > 0 ? amount : null,
    priceCurrency: currency,
    location: clean(candidate.location) || null,
    contact: clean(candidate.contact) || null,
    confidence
  };
}

function scoreCandidate(candidate, demand = {}) {
  let score = 0;
  const reasons = [];

  if (candidate.sourceUrl) {
    score += 20;
    reasons.push('fuente_publica');
  }

  if (candidate.contact) {
    score += 25;
    reasons.push('contacto_disponible');
  }

  if (candidate.confidence === 'high') {
    score += 20;
    reasons.push('confianza_alta');
  } else if (candidate.confidence === 'medium') {
    score += 10;
    reasons.push('confianza_media');
  }

  if (candidate.priceAmount) {
    score += 10;
    reasons.push('precio_publicado');
  }

  const budget = demand?.budget && typeof demand.budget === 'object'
    ? demand.budget
    : null;
  const budgetMax = Number(budget?.maxAmount || budget?.amount || 0);
  const budgetCurrency = clean(budget?.currency).toUpperCase();

  if (
    budgetMax > 0 &&
    candidate.priceAmount &&
    candidate.priceCurrency &&
    (!budgetCurrency || candidate.priceCurrency === budgetCurrency)
  ) {
    if (candidate.priceAmount <= budgetMax) {
      score += 15;
      reasons.push('dentro_presupuesto');
    } else {
      score -= 10;
      reasons.push('sobre_presupuesto');
    }
  }

  const desiredLocation = clean(
    demand?.preferredLocation?.city ||
    demand?.preferredLocation?.department ||
    demand?.preferredLocation?.country
  ).toLowerCase();

  if (
    desiredLocation &&
    clean(candidate.location).toLowerCase().includes(desiredLocation)
  ) {
    score += 10;
    reasons.push('ubicacion_coincide');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons
  };
}

function evaluateCandidates(candidates = [], demand = {}) {
  const evaluated = (Array.isArray(candidates) ? candidates : [])
    .map(normalizeCandidate)
    .filter((candidate) => candidate.sourceUrl)
    .map((candidate) => {
      const { score, reasons } = scoreCandidate(candidate, demand);
      return {
        ...candidate,
        elanScore: score,
        elanDecision: 'reserve',
        elanReasons: reasons,
        contactStatus: candidate.contact ? 'ready' : 'contact_missing',
        contactMethod: inferContactMethod(candidate)
      };
    })
    .sort((a, b) => b.elanScore - a.elanScore);

  return evaluated.map((candidate, index) => ({
    ...candidate,
    elanDecision:
      index < 3 && candidate.elanScore >= 35
        ? 'shortlist'
        : candidate.elanScore >= 20
          ? 'reserve'
          : 'reject'
  }));
}

async function createMarketplaceInquiry(input = {}, env = process.env) {
  const assetCode = clean(input.assetCode);
  const action = clean(input.action);

  if (!assetCode) {
    const error = new Error('Falta assetCode para registrar la consulta Marketplace.');
    error.code = 'MARKETPLACE_INQUIRY_ASSET_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  if (!action) {
    const error = new Error('Falta action para registrar la consulta Marketplace.');
    error.code = 'MARKETPLACE_INQUIRY_ACTION_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const requesterPartyId = clean(input.requesterPartyId);
  const requesterRefId = clean(input.requesterRefId);
  const requesterRefType = clean(input.requesterRefType);

  if (!requesterPartyId && !requesterRefId) {
    const error = new Error(
      'La consulta Marketplace requiere una identidad oficial existente en CONNECT.'
    );
    error.code = 'MARKETPLACE_INQUIRY_IDENTITY_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const result = await marketplace.marketplaceCreateInquiry({
    assetCode,
    action,
    ...(requesterPartyId ? { requesterPartyId } : {}),
    ...(requesterRefId ? { requesterRefId } : {}),
    ...(requesterRefType ? { requesterRefType } : {}),
    ...(input.offerAmount && typeof input.offerAmount === 'object'
      ? { offerAmount: input.offerAmount }
      : {}),
    ...(clean(input.message) ? { message: clean(input.message) } : {})
  }, env);

  return {
    ok: true,
    autonomous: true,
    authority: 'CONNECT',
    operator: 'ELAN',
    state: 'INQUIRY_RECORDED',
    inquiry: unwrap(result),
    humanInterventionRequired: false
  };
}

function marketplaceMissionSearchDue(mission = {}, retryMs = 0, now = Date.now()) {
  if (clean(mission.status) === 'queued') return true;
  if (clean(mission.status) !== 'searching') return false;
  if (!Number.isFinite(retryMs) || retryMs <= 0) return true;

  const updatedAt = Date.parse(clean(mission.updatedAt));
  if (!Number.isFinite(updatedAt)) return true;
  return now - updatedAt >= retryMs;
}

async function continueMarketplaceDemand(
  demand = {},
  env = process.env,
  options = {}
) {
  const demandKey = clean(demand.demandCode || demand.id);

  if (!demandKey) {
    const error = new Error('La demanda Marketplace no tiene demandCode ni id.');
    error.code = 'MARKETPLACE_DEMAND_KEY_MISSING';
    error.statusCode = 400;
    throw error;
  }

  const matchingPayload = await marketplace.marketplaceRunMatching(demandKey, env);
  const matching = unwrap(matchingPayload) || {};
  const matches = Array.isArray(matching.matches) ? matching.matches : [];
  const searchMissionCode = clean(matching.searchMissionCode);

  if (matches.length) {
    return {
      ok: true,
      autonomous: true,
      authority: 'CONNECT',
      operator: 'ELAN',
      state: 'MATCH_FOUND',
      demand,
      matching,
      matches,
      searchMissionCode: null,
      externalSearch: null,
      humanInterventionRequired: false
    };
  }

  if (!searchMissionCode) {
    return {
      ok: true,
      autonomous: true,
      authority: 'CONNECT',
      operator: 'ELAN',
      state: 'SEARCH_REQUIRED',
      demand,
      matching,
      matches: [],
      searchMissionCode: null,
      externalSearch: null,
      humanInterventionRequired: false
    };
  }

  const missionPayload = await marketplace.marketplaceGetSearchMission(
    searchMissionCode,
    env
  );
  const mission = unwrap(missionPayload) || missionPayload || {};

  if (clean(mission.assignedAgent) !== 'elan') {
    return {
      ok: true,
      autonomous: false,
      authority: 'CONNECT',
      operator: clean(mission.assignedAgent) || 'human',
      state: 'MISSION_NOT_ASSIGNED_TO_ELAN',
      demand,
      matching,
      matches: [],
      mission,
      searchMissionCode,
      externalSearch: null,
      humanInterventionRequired: true
    };
  }

  const missionStatus = clean(mission.status);

  if (['candidate_found', 'paused', 'completed', 'cancelled'].includes(missionStatus)) {
    return {
      ok: true,
      autonomous: true,
      authority: 'CONNECT',
      operator: 'ELAN',
      state:
        missionStatus === 'candidate_found'
          ? 'CANDIDATES_ALREADY_FOUND'
          : 'MISSION_NOT_ACTIONABLE',
      demand,
      matching,
      matches: [],
      mission,
      searchMissionCode,
      externalSearch: null,
      humanInterventionRequired: false
    };
  }

  const retryMs = Number(options.retryMs || 0);
  const now = Number.isFinite(Number(options.now))
    ? Number(options.now)
    : Date.now();

  if (!marketplaceMissionSearchDue(mission, retryMs, now)) {
    return {
      ok: true,
      autonomous: true,
      authority: 'CONNECT',
      operator: 'ELAN',
      state: 'SEARCH_COOLDOWN',
      demand,
      matching,
      matches: [],
      mission,
      searchMissionCode,
      externalSearch: null,
      humanInterventionRequired: false
    };
  }

  await marketplace.marketplaceUpdateSearchMissionStatus(
    searchMissionCode,
    'searching',
    env
  );

  let externalSearch;

  try {
    externalSearch = await webSearch.searchMarketplaceNeed(demand, env);
  } catch (error) {
    error.marketplaceDemandCode = demandKey;
    error.searchMissionCode = searchMissionCode;
    throw error;
  }

  const candidates = evaluateCandidates(
    Array.isArray(externalSearch.candidates) ? externalSearch.candidates : [],
    demand
  );

  const persistedMissionPayload =
    await marketplace.marketplaceRecordSearchMissionResults(
      searchMissionCode,
      candidates,
      externalSearch.searchSummary,
      env
    );

  return {
    ok: true,
    autonomous: true,
    authority: 'CONNECT',
    operator: 'ELAN',
    state: candidates.length
      ? 'EXTERNAL_CANDIDATES_FOUND'
      : 'SEARCHING_NO_CANDIDATE_YET',
    demand,
    matching,
    matches: [],
    mission: unwrap(persistedMissionPayload) || persistedMissionPayload,
    searchMissionCode,
    externalSearch,
    externalCandidates: candidates,
    persisted: true,
    humanInterventionRequired: false
  };
}

async function manageMarketplaceNeed(input = {}, env = process.env) {
  const demandInput = {
    ...input,
    source: clean(input.source) || 'ELAN_GO'
  };

  const createdPayload = await marketplace.marketplaceCreateDemand(
    demandInput,
    env
  );

  const demand = unwrap(createdPayload) || {};

  return continueMarketplaceDemand(demand, env);
}

module.exports = {
  continueMarketplaceDemand,
  createMarketplaceInquiry,
  evaluateCandidates,
  inferContactMethod,
  manageMarketplaceNeed,
  marketplaceMissionSearchDue
};
