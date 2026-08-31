'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const worker = require('../services/elanMarketplaceBrokerWorkerService');

test('ELAN GO OFF no lista demandas ni ejecuta trabajo', async () => {
  let listCalls = 0;
  let heartbeatCalls = 0;

  const result = await worker.runElanMarketplaceBrokerWorkerOnce({
    env: {},
    getControl: async () => ({
      enabled: false,
      spendEnabled: false,
      outreachEnabled: false
    }),
    recordHeartbeat: async () => {
      heartbeatCalls += 1;
      return { ok: true };
    },
    listDemands: async () => {
      listCalls += 1;
      return { result: [] };
    }
  });

  assert.equal(result.state, 'CONTROL_DISABLED');
  assert.equal(listCalls, 0);
  assert.equal(heartbeatCalls, 1);
});

test('spend OFF bloquea el ciclo aunque ELAN GO esté encendido', async () => {
  let listCalls = 0;

  const result = await worker.runElanMarketplaceBrokerWorkerOnce({
    env: {},
    getControl: async () => ({
      enabled: true,
      spendEnabled: false,
      outreachEnabled: false
    }),
    recordHeartbeat: async () => ({ ok: true }),
    listDemands: async () => {
      listCalls += 1;
      return { result: [] };
    }
  });

  assert.equal(result.state, 'CONTROL_SPEND_DISABLED');
  assert.equal(listCalls, 0);
});

test('CONNECT caído mantiene fail-closed', async () => {
  let listCalls = 0;

  await assert.rejects(
    () => worker.runElanMarketplaceBrokerWorkerOnce({
      env: {},
      getControl: async () => {
        const error = new Error('CONNECT_DOWN');
        error.code = 'CONNECT_DOWN';
        throw error;
      },
      listDemands: async () => {
        listCalls += 1;
        return { result: [] };
      }
    }),
    /CONNECT_DOWN/
  );

  assert.equal(listCalls, 0);
});

test('una demanda fallida no detiene las siguientes', async () => {
  const result = await worker.runElanMarketplaceBrokerWorkerOnce({
    env: {
      ELAN_MARKETPLACE_BROKER_MAX_SEARCHES_PER_RUN: '5'
    },
    getControl: async () => ({
      enabled: true,
      spendEnabled: true,
      outreachEnabled: true
    }),
    recordHeartbeat: async () => ({ ok: true }),
    processInterests: async () => ({
      ok: true,
      processed: 0,
      contacted: 0,
      results: []
    }),
    runBuyerHunter: async () => ({
      ok: true,
      offersScanned: 0,
      buyersFound: 0,
      results: []
    }),
    runDiscovery: async () => ({
      ok: true,
      searches: 0,
      published: 0,
      category: 'vehicle',
      results: []
    }),
    listDiscoveries: async () => ({
      result: Array.from({ length: 100 }, (_, index) => ({
        discoveryCode: `DISC-${String(index + 1).padStart(6, '0')}`,
        kind: 'offer',
        status: 'active',
        verificationStatus: 'validated'
      }))
    }),
    listDemands: async () => ({
      result: [
        { id: 'bad', demandCode: 'BAD' },
        { id: 'good', demandCode: 'GOOD' }
      ]
    }),
    continueDemand: async (demand) => {
      if (demand.demandCode === 'BAD') {
        const error = new Error('DEMAND_TEST_FAILURE');
        error.code = 'DEMAND_TEST_FAILURE';
        throw error;
      }
      return {
        state: 'EXTERNAL_CANDIDATES_FOUND',
        searchMissionCode: 'SEARCH-GOOD'
      };
    }
  });

  assert.equal(result.failedDemands, 1);
  assert.equal(result.searches, 1);
  assert.equal(result.results.length, 2);
});
