'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeDesignRequest,
  getDesignEngineConfigurationStatus
} = require('../adapters/designEngineAdapter');

test('Design Engine Adapter expone configuración stub segura', () => {
  const status = getDesignEngineConfigurationStatus();

  assert.equal(status.available, true);
  assert.equal(status.configured, true);
  assert.equal(status.connected, false);
  assert.equal(status.mode, 'stub');
  assert.equal(status.externalExecutionEnabled, false);
});

test('Design Engine Adapter acepta únicamente solicitudes de ELAN IA', async () => {
  const result = await executeDesignRequest({
    requestId: 'DESIGN-REQ-001',
    actor: { source: 'ELAN_IA' },
    platform: 'ELANVISUAL'
  });

  assert.equal(result.status, 'STUB_ACCEPTED');
  assert.equal(result.conversational, false);
  assert.equal(result.platform, 'ELANVISUAL');
  assert.equal(result.result, null);
});

test('Design Engine Adapter rechaza entrada directa externa', async () => {
  await assert.rejects(
    () => executeDesignRequest({
      requestId: 'DESIGN-REQ-002',
      actor: { source: 'CLIENT' }
    }),
    error => error.code === 'DESIGN_ENTRY_SOURCE_INVALID'
  );
});

test('Design Engine Adapter rechaza solicitudes inválidas', async () => {
  await assert.rejects(
    () => executeDesignRequest(null),
    error => error.code === 'DESIGN_REQUEST_INVALID'
  );
});
