'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  processQuotationModeText
} = require('../services/ownerQuotationModeElanOneLabBridge');

const DEPLOY_COMMIT =
  '1234567890abcdef1234567890abcdef12345678';

async function expectBypass(text) {
  const result = await processQuotationModeText({
    identity: {
      externalUserId: 'owner-test',
      phone: '50500000000',
      chatId: 'owner-test@c.us'
    },
    text
  });

  assert.deepEqual(result, {
    handled: false,
    bypassed: true,
    mode: 'quotation'
  });
}

test('bridge no consume deploy Owner OPS antes del router técnico', async () => {
  await expectBypass(`ELAN despliega Orchestrator commit ${DEPLOY_COMMIT}`);
});

test('bridge no consume consultas y confirmaciones OPS', async () => {
  await expectBypass('ELAN estado OPS-1786850409219-ABC123');
  await expectBypass('CONFIRMAR OPS-1786850409219-ABC123');
});

test('bridge no consume comandos operativos protegidos', async () => {
  await expectBypass('ELAN logs supervisor');
  await expectBypass('ELAN estado WAHA');
  await expectBypass('ELAN health Orchestrator');
});
