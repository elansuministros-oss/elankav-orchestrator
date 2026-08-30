'use strict';

const marketplace = require('./ownerBusinessConnectClient');
const autonomy = require('./elanMarketplaceAutonomyService');

const state = {
  running: false,
  processed: 0,
  skipped: 0,
  failed: 0,
  controlEnabled: false,
  outreachEnabled: false,
  spendEnabled: false,
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
  continueDemand = autonomy.continueMarketplaceDemand
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
      failedDemands: 0,
      results: []
    };
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
      failedDemands: 0,
      results: []
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

  if (!demands.length) state.lastState = 'IDLE_NO_ACTIVE_DEMANDS';

  for (const demand of demands) {
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

  if (failedDemands === 0) state.lastErrorCode = null;

  const successAt = failedDemands === 0 ? nowIso : null;
  const cycleError = failedDemands > 0 ? state.lastErrorCode : null;

  await bestEffortHeartbeat({
    recordHeartbeat,
    env,
    nowIso,
    lastSuccessAt: successAt,
    lastError: cycleError
  });

  return {
    ok: failedDemands === 0,
    autonomous: true,
    authority: 'CONNECT',
    operator: 'ELAN',
    state: state.lastState || 'IDLE',
    enabled: control.enabled,
    outreachEnabled: control.outreachEnabled,
    spendEnabled: control.spendEnabled,
    activeDemands: demands.length,
    searches,
    failedDemands,
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
        searches: result.searches,
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
