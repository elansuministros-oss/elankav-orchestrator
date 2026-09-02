'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OWNER_OPS_CONTROL_PATTERN
} = require('../services/inboundCommercialRoleMessagePatch');

test('commercial role router never captures exact Owner Ops deploy syntax', () => {
  const sha = '3d80fd96db64acfde3968ae2f7ede49453f7042f';
  assert.equal(
    OWNER_OPS_CONTROL_PATTERN.test(`ELAN despliega Orchestrator commit ${sha}\nNo reinicies WAHA.`),
    true
  );
  assert.equal(
    OWNER_OPS_CONTROL_PATTERN.test(`ELAN despliega Langflow commit ${sha}`),
    true
  );
});

test('commercial role router does not exempt vague deploy-like customer text', () => {
  assert.equal(OWNER_OPS_CONTROL_PATTERN.test('quiero desplegar un rótulo para mi negocio'), false);
  assert.equal(OWNER_OPS_CONTROL_PATTERN.test('ELAN despliega Orchestrator commit abc123'), false);
});
