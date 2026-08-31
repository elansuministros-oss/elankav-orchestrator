'use strict';

const marketplace = require('./ownerBusinessConnectClient');
const autonomy = require('./elanMarketplaceAutonomyService');
const discovery = require('./elanMarketplaceDiscoveryService');
const interestOutreach = require('./elanMarketplaceInterestOutreachService');
const buyerHunter = require('./elanMarketplaceBuyerHunterService');

const state = {
  running: false,
  processed: 0,
  skipped: 0,
  failed: 0,
  controlEnabled: false,
  outreachEnabled: false,
  spendEnabled: false,
  discoveriesPublished: 0,
  interestsProcessed: 0,
  interestsContacted: 0,
  buyerHunts: 0,
  buyersFound: 0,
  catalogOfferCount: 0,
  catalogTarget: 0,
  catalogMode: null,
  lastBuyerHuntAt: null,
  lastDiscoveryAt: null,
  lastDiscoveryCategory: null,
  lastControlAt: null,
  lastHeartbeatAt: null,
  lastRunAt: null,
  lastDemandCode: null,
  lastMissionCode: null,
  lastState: null,
  lastErrorCode: null
};

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

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}

function errorCode(error) {
  return clean(
    error?.code ||
    error?.message ||
    'ELAN_MARKETPLACE_BROKER_FAILED'
  );
}

function normalizeControl(payload) {
  const control = unwrap(payload) || {};
  return {
    enabled: control.enabled === true,
    outreachEnabled: control.outreachEnabled === true,
    spendEnabled: control.spendEnabled === true,
    paymentUrl: clean(control.paymentUrl) || null
  };
}

async function bestEffortHeartbeat({
  recordHeartbeat,
  env,
  nowIso,
  lastSuccessAt,
  lastError
}) {
  const body = {
    heartbeatAt: nowIso,
    lastCycleAt: nowIso,
    ...(lastSuccessAt ? { lastSuccessAt } : {}),
    ...(lastError !== undefined ? { lastError } : {})
  };

  try {
    await recordHeartbeat(body, env);
    state.lastHeartbeatAt = nowIso;
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (!state.lastErrorCode) state.lastErrorCode = code;

    console.error('[ELAN_MARKETPLACE_BROKER_HEARTBEAT_FAILED]', {
      code,
      message: error?.message || String(error)
    });

    return false;
  }
}

async function runElanMarketplaceBrokerWorkerOnce({
  env = process.env,
  now = Date.now(),
  getControl = marketplace.getElanGoControl,
  recordHeartbeat = marketplace.recordElanGoHeartbeat,
  listDemands = marketplace.marketplaceListDemands,
  listDiscoveries = marketplace.marketplaceListDiscoveries,
  continueDemand = autonomy.continueMarketplaceDemand,
  runDiscovery = discovery.runCatalogDiscoveryCycle,
  processInterests = interestOutreach.processPendingDiscoveryInterests,
  runBuyerHunter = buyerHunter.runBuyerHunterCycle
} = {}) {
  const nowIso = new Date(now).toISOString();
  state.lastRunAt = nowIso;

  let controlPayload;

  try {
    controlPayload = await getControl(env);
  } catch (error) {
    state.controlEnabled = false;
    state.outreachEnabled = false;
    state.spendEnabled = false;
    state.lastControlAt = nowIso;
    state.lastState = 'CONTROL_UNAVAILABLE';
    state.lastErrorCode = errorCode(error);
    throw error;
  }

  const control = normalizeControl(controlPayload);

  state.controlEnabled = control.enabled;
  state.outreachEnabled = control.outreachEnabled;
  state.spendEnabled = control.spendEnabled;
  state.lastControlAt = nowIso;

  if (!control.enabled) {
    state.lastState = 'CONTROL_DISABLED';
    state.lastErrorCode = null;

    await bestEffortHeartbeat({
      recordHeartbeat,
      env,
      nowIso,
      lastError: null
    });

    return {
      ok: true,
      autonomous: true,
      authority: 'CONNECT',
      operator: 'ELAN',
      state: 'CONTROL_DISABLED',
      enabled: false,
      outreachEnabled: control.outreachEnabled,
      spendEnabled: control.spendEnabled,
      activeDemands: 0,
      searches: 0,
      discoverySearches: 0,
      publishedDiscoveries: 0,
      failedDiscovery: 0,
      failedInterestOutreach: 0,
      failedDemands: 0,
      interests: null,
      results: []
    };
  }

  let interestResult = null;
  let failedInterestOutreach = 0;

  if (control.outreachEnabled) {
    try {
      interestResult = await processInterests({
        env,
        limit: positiveInteger(
          env.ELAN_MARKETPLACE_INTERESTS_PER_RUN,
          3
        )
      });
      state.interestsProcessed += Number(interestResult?.processed || 0);
      state.interestsContacted += Number(interestResult?.contacted || 0);
      if (Number(interestResult?.contacted || 0) > 0) {
        state.lastState = 'SELLER_OUTREACH_STARTED';
      }
    } catch (error) {
      failedInterestOutreach = 1;
      state.failed += 1;
      state.lastErrorCode = errorCode(error);
      state.lastState = 'INTEREST_OUTREACH_FAILED';
      console.error('[ELAN_MARKETPLACE_INTEREST_OUTREACH_FAILED]', {
        code: state.lastErrorCode,
        message: error?.message || String(error)
      });
    }
  }

  if (!control.spendEnabled) {
    state.lastState = 'CONTROL_SPEND_DISABLED';
    state.lastErrorCode = null;

    await bestEffortHeartbeat({
      recordHeartbeat,
      env,
      nowIso,
      lastError: null
    });

    return {
      ok: true,
      autonomous: true,
      authority: 'CONNECT',
      operator: 'ELAN',
      state: 'CONTROL_SPEND_DISABLED',
      enabled: true,
      outreachEnabled: control.outreachEnabled,
      spendEnabled: false,
      activeDemands: 0,
      searches: 0,
      discoverySearches: 0,
      publishedDiscoveries: 0,
      failedDiscovery: 0,
      failedDemands: 0,
      results: []
    };
  }

  const catalogTarget = positiveInteger(
    env.ELAN_MARKETPLACE_CATALOG_TARGET_OFFERS,
    100
  );

  let catalogOfferCount = 0;
  try {
    const catalogPayload = unwrap(await listDiscoveries({
      kind: 'offer',
      limit: Math.max(100, Math.min(500, catalogTarget + 50))
    }, env));
    const catalogItems = Array.isArray(catalogPayload) ? catalogPayload : [];
    catalogOfferCount = catalogItems.filter((item) =>
      clean(item.kind) === 'offer' &&
      clean(item.status) === 'active' &&
      clean(item.verificationStatus) === 'validated'
    ).length;
  } catch (error) {
    const code = errorCode(error);
    state.lastErrorCode = code;
    state.lastState = 'CATALOG_COUNT_FAILED';
    throw error;
  }

  const catalogBootstrap = catalogOfferCount < catalogTarget;
  state.catalogOfferCount = catalogOfferCount;
  state.catalogTarget = catalogTarget;
  state.catalogMode = catalogBootstrap
    ? 'CATALOG_BOOTSTRAP'
    : 'CATALOG_OPERATIONAL';

  const discoveryIntervalMs = positiveInteger(
    catalogBootstrap
      ? env.ELAN_MARKETPLACE_CATALOG_BOOTSTRAP_INTERVAL_MS
      : env.ELAN_MARKETPLACE_DISCOVERY_INTERVAL_MS,
    catalogBootstrap
      ? 5 * 60 * 1000
      : 15 * 60 * 1000
  );

  const lastDiscoveryMs = state.lastDiscoveryAt
    ? Date.parse(state.lastDiscoveryAt)
    : Number.NaN;

  const discoveryDue =
    !Number.isFinite(lastDiscoveryMs) ||
    now - lastDiscoveryMs >= discoveryIntervalMs;

  let discoveryResult = null;
  let discoverySearches = 0;
  let publishedDiscoveries = 0;
  let failedDiscovery = 0;

  if (discoveryDue) {
    try {
      discoveryResult = await runDiscovery({
        env,
        now,
        mode: catalogBootstrap ? 'bootstrap' : 'replenish'
      });

      discoverySearches = Number(discoveryResult?.searches || 0);
      publishedDiscoveries = Number(discoveryResult?.published || 0);
      state.discoveriesPublished += publishedDiscoveries;
      state.catalogOfferCount = catalogOfferCount + publishedDiscoveries;
      state.lastDiscoveryAt = nowIso;
      state.lastDiscoveryCategory =
        clean(discoveryResult?.category) || null;

      state.lastState =
        publishedDiscoveries > 0
          ? 'DISCOVERY_PUBLISHED'
          : 'DISCOVERY_SCAN_COMPLETE';
    } catch (error) {
      failedDiscovery = 1;
      state.failed += 1;
      state.lastState = 'DISCOVERY_FAILED';
      state.lastErrorCode = errorCode(error);

      console.error('[ELAN_MARKETPLACE_DISCOVERY_FAILED]', {
        code: state.lastErrorCode,
        message: error?.message || String(error)
      });
    }
  }

  let buyerHunterResult = null;
  let failedBuyerHunter = 0;

  const buyerHunterIntervalMs = positiveInteger(
    env.ELAN_MARKETPLACE_BUYER_HUNTER_INTERVAL_MS,
    15 * 60 * 1000
  );
  const lastBuyerHuntMs = state.lastBuyerHuntAt
    ? Date.parse(state.lastBuyerHuntAt)
    : Number.NaN;
  const buyerHunterDue =
    !Number.isFinite(lastBuyerHuntMs) ||
    now - lastBuyerHuntMs >= buyerHunterIntervalMs;

  if (buyerHunterDue && !catalogBootstrap) {
    try {
      buyerHunterResult = await runBuyerHunter({
        env,
        now,
        limit: positiveInteger(
          env.ELAN_MARKETPLACE_BUYER_HUNTER_OFFERS_PER_RUN,
          2
        )
      });
      state.buyerHunts += Number(buyerHunterResult?.offersScanned || 0);
      state.buyersFound += Number(buyerHunterResult?.buyersFound || 0);
      state.lastBuyerHuntAt = nowIso;

      if (Number(buyerHunterResult?.buyersFound || 0) > 0) {
        state.lastState = 'BUYERS_FOUND';
      }
    } catch (error) {
      failedBuyerHunter = 1;
      state.failed += 1;
      state.lastErrorCode = errorCode(error);
      state.lastState = 'BUYER_HUNTER_FAILED';
      console.error('[ELAN_MARKETPLACE_BUYER_HUNTER_FAILED]', {
        code: state.lastErrorCode,
        message: error?.message || String(error)
      });
    }
  }

  if (catalogBootstrap) {
    buyerHunterResult = {
      ok: true,
      state: 'WAITING_FOR_CATALOG',
      offersScanned: 0,
      buyersFound: 0,
      catalogOfferCount,
      catalogTarget
    };
  }

  const payload = await listDemands(env);
  const demandsPayload = unwrap(payload);
  const demands = Array.isArray(demandsPayload) ? demandsPayload : [];

  const retryMs = positiveInteger(
    env.ELAN_MARKETPLACE_SEARCH_RETRY_MS,
    6 * 60 * 60 * 1000
  );

  const maximumSearches = positiveInteger(
    env.ELAN_MARKETPLACE_BROKER_MAX_SEARCHES_PER_RUN,
    1
  );

  let searches = 0;
  let failedDemands = 0;
  const results = [];

  if (catalogBootstrap) {
    state.lastState =
      publishedDiscoveries > 0
        ? 'CATALOG_BOOTSTRAP_PUBLISHED'
        : 'CATALOG_BOOTSTRAP';
  } else if (!demands.length && !discoveryDue) {
    state.lastState = 'IDLE_NO_ACTIVE_DEMANDS';
  } else if (
    !demands.length &&
    discoveryDue &&
    failedDiscovery === 0 &&
    publishedDiscoveries === 0
  ) {
    state.lastState = 'DISCOVERY_SCAN_COMPLETE';
  } else if (
    !demands.length &&
    discoveryDue &&
    publishedDiscoveries > 0
  ) {
    state.lastState = 'DISCOVERY_PUBLISHED';
  }

  for (const demand of catalogBootstrap ? [] : demands) {
    if (searches >= maximumSearches) break;

    const demandCode = clean(demand.demandCode || demand.id) || null;
    state.lastDemandCode = demandCode;

    try {
      const result = await continueDemand(
        demand,
        env,
        { retryMs, now }
      );

      state.lastMissionCode = clean(result.searchMissionCode) || null;
      state.lastState = clean(result.state) || null;

      results.push({
        demandCode: state.lastDemandCode,
        missionCode: state.lastMissionCode,
        state: state.lastState
      });

      if (
        ['EXTERNAL_CANDIDATES_FOUND', 'SEARCHING_NO_CANDIDATE_YET']
          .includes(result.state)
      ) {
        searches += 1;
        state.processed += 1;
      } else {
        state.skipped += 1;
      }
    } catch (error) {
      const code = errorCode(error);
      failedDemands += 1;
      state.failed += 1;
      state.lastMissionCode = null;
      state.lastState = 'DEMAND_FAILED';
      state.lastErrorCode = code;

      results.push({
        demandCode,
        missionCode: null,
        state: 'DEMAND_FAILED',
        errorCode: code
      });

      console.error('[ELAN_MARKETPLACE_BROKER_DEMAND_FAILED]', {
        demandCode,
        code,
        message: error?.message || String(error)
      });
    }
  }

  if (
    failedDemands === 0 &&
    failedDiscovery === 0 &&
    failedInterestOutreach === 0 &&
    failedBuyerHunter === 0
  ) {
    state.lastErrorCode = null;
  }

  const cycleFailed =
    failedDemands > 0 ||
    failedDiscovery > 0 ||
    failedInterestOutreach > 0 ||
    failedBuyerHunter > 0;

  const successAt = cycleFailed ? null : nowIso;
  const cycleError = cycleFailed ? state.lastErrorCode : null;

  await bestEffortHeartbeat({
    recordHeartbeat,
    env,
    nowIso,
    lastSuccessAt: successAt,
    lastError: cycleError
  });

  return {
    ok:
      failedDemands === 0 &&
      failedDiscovery === 0 &&
      failedInterestOutreach === 0 &&
      failedBuyerHunter === 0,
    autonomous: true,
    authority: 'CONNECT',
    operator: 'ELAN',
    state: state.lastState || 'IDLE',
    enabled: control.enabled,
    outreachEnabled: control.outreachEnabled,
    spendEnabled: control.spendEnabled,
    activeDemands: demands.length,
    catalogOfferCount: state.catalogOfferCount,
    catalogTarget,
    catalogMode: state.catalogMode,
    searches,
    discoverySearches,
    publishedDiscoveries,
    failedDiscovery,
    failedInterestOutreach,
    failedBuyerHunter,
    failedDemands,
    discovery: discoveryResult,
    buyerHunter: buyerHunterResult,
    interests: interestResult,
    results
  };
}

function startElanMarketplaceBrokerWorker({
  env = process.env,
  runOnce = runElanMarketplaceBrokerWorkerOnce
} = {}) {
  const localGate = clean(
    env.ELAN_MARKETPLACE_BROKER_WORKER_ENABLED
  ).toLowerCase();

  if (localGate === 'false') {
    state.lastState = 'LOCAL_EMERGENCY_DISABLED';
    return {
      started: false,
      reason: 'LOCAL_EMERGENCY_DISABLED'
    };
  }

  const intervalMs = positiveInteger(
    env.ELAN_MARKETPLACE_BROKER_INTERVAL_MS,
    60 * 1000
  );

  const tick = async () => {
    if (state.running) return;
    state.running = true;

    try {
      const result = await runOnce({ env });

      console.log('[ELAN_MARKETPLACE_BROKER]', {
        state: result.state,
        enabled: result.enabled,
        spendEnabled: result.spendEnabled,
        outreachEnabled: result.outreachEnabled,
        activeDemands: result.activeDemands,
        catalogOfferCount: result.catalogOfferCount || 0,
        catalogTarget: result.catalogTarget || 0,
        catalogMode: result.catalogMode || null,
        searches: result.searches,
        interestsProcessed: result.interests?.processed || 0,
        interestsContacted: result.interests?.contacted || 0,
        buyerOffersScanned: result.buyerHunter?.offersScanned || 0,
        buyersFound: result.buyerHunter?.buyersFound || 0,
        failedBuyerHunter: result.failedBuyerHunter || 0,
        failedInterestOutreach: result.failedInterestOutreach || 0,
        failedDemands: result.failedDemands,
        processed: state.processed,
        skipped: state.skipped
      });
    } catch (error) {
      state.failed += 1;
      state.lastState = 'CONTROL_UNAVAILABLE';
      state.lastErrorCode = errorCode(error);

      console.error('[ELAN_MARKETPLACE_BROKER_FAILED_CLOSED]', {
        code: error?.code || null,
        message: error?.message || String(error)
      });
    } finally {
      state.running = false;
    }
  };

  void tick();

  const timer = setInterval(
    tick,
    Math.max(1000, intervalMs)
  );

  if (typeof timer.unref === 'function') timer.unref();

  return {
    started: true,
    intervalMs,
    authority: 'CONNECT'
  };
}

function getElanMarketplaceBrokerWorkerState() {
  return Object.freeze({ ...state });
}

module.exports = {
  getElanMarketplaceBrokerWorkerState,
  runElanMarketplaceBrokerWorkerOnce,
  startElanMarketplaceBrokerWorker
};
