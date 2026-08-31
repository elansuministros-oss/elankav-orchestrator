'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createConnectMarketplaceToolAdapter
} = require('../adapters/connectMarketplaceToolAdapter');
const {
  ELAN_COMMERCIAL_TOOLS,
  executeCommercialTool,
  runCommercialToolDecision
} = require('../services/openaiCommercialToolService');

test('CONNECT tool adapter keeps auth inside infrastructure headers', async () => {
  const calls = [];
  const adapter = createConnectMarketplaceToolAdapter({
    env: {
      CONNECT_BASE_URL: 'https://connect.example',
      MARKETPLACE_RUNTIME_TOKEN: 'SERVER_ONLY_TOKEN'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        elanGoEnabled: false,
        outreachEnabled: false,
        capabilities: []
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  await adapter.getContactCapabilities();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://connect.example/api/v1/marketplace/contact-capabilities');
  assert.equal(
    calls[0].init.headers['X-Elankav-Marketplace-Token'],
    'SERVER_ONLY_TOKEN'
  );
  assert.equal(calls[0].init.headers['X-Elankav-Actor-Role'], 'owner');
});

test('commercial OpenAI tool schemas never contain credentials', () => {
  const serialized = JSON.stringify(ELAN_COMMERCIAL_TOOLS);
  assert.match(serialized, /get_contact_capabilities/);
  assert.match(serialized, /execute_contact_next/);
  assert.doesNotMatch(serialized, /TOKEN|access_token|api_key|password/i);
});

test('tool runner returns CONNECT result through function_call_output', async () => {
  const calls = [];
  const responses = [
    {
      id: 'resp-1',
      outputText: '',
      output: [{
        type: 'function_call',
        call_id: 'call-1',
        name: 'get_contact_capabilities',
        arguments: '{}'
      }]
    },
    {
      id: 'resp-2',
      outputText: 'ELAN GO está bloqueado.',
      output: []
    }
  ];

  const adapter = {
    async getContactCapabilities() {
      return {
        elanGoEnabled: false,
        outreachEnabled: false,
        capabilities: [{
          channel: 'whatsapp',
          state: 'BLOCKED',
          transportState: 'VERIFIED'
        }]
      };
    },
    async executeContactNext() {
      throw new Error('unexpected execute');
    }
  };

  const result = await runCommercialToolDecision({
    input: '¿Puedo contactar este caso?',
    adapter,
    createToolResponseImpl: async payload => {
      calls.push(payload);
      return responses.shift();
    }
  });

  assert.equal(result.outputText, 'ELAN GO está bloqueado.');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].previousResponseId, 'resp-1');
  assert.equal(calls[1].input[0].type, 'function_call_output');
  const toolOutput = JSON.parse(calls[1].input[0].output);
  assert.equal(toolOutput.ok, true);
  assert.equal(toolOutput.result.capabilities[0].state, 'BLOCKED');
});

test('execute tool returns blocked/failed CONNECT errors without fabricating success', async () => {
  const adapter = {
    async getContactCapabilities() {
      return {};
    },
    async executeContactNext() {
      const error = new Error('El contacto comercial está apagado.');
      error.code = 'CONTACT_CAPABILITY_NOT_VERIFIED';
      error.status = 409;
      throw error;
    }
  };

  const result = await executeCommercialTool({
    name: 'execute_contact_next',
    arguments: JSON.stringify({ case_code: 'CONTACT-ABC123' })
  }, adapter);

  assert.equal(result.ok, false);
  assert.deepEqual(result.error, {
    code: 'CONTACT_CAPABILITY_NOT_VERIFIED',
    message: 'El contacto comercial está apagado.',
    status: 409
  });
});
