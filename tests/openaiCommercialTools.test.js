'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createConnectChannelToolAdapter
} = require('../adapters/connectChannelToolAdapter');
const {
  GLOBAL_CHANNEL_TOOL,
  COMMERCIAL_BRIEFING_TOOL,
  MARKETPLACE_CONTACT_TOOL,
  executeChannelTool,
  runChannelToolDecision,
  toolsForScope
} = require('../services/openaiChannelToolService');

test('global CONNECT channel adapter keeps auth inside infrastructure headers', async () => {
  const calls = [];
  const adapter = createConnectChannelToolAdapter({
    env: {
      CONNECT_BASE_URL: 'https://connect.example',
      CONNECT_INTERNAL_API_TOKEN: 'SERVER_ONLY_GLOBAL_TOKEN'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        scope: 'ELANKAV_GLOBAL',
        capabilities: []
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  await adapter.getChannelCapabilities();

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://connect.example/api/v1/channels/capabilities'
  );
  assert.equal(
    calls[0].init.headers['X-Elankav-Internal-Token'],
    'SERVER_ONLY_GLOBAL_TOKEN'
  );
  assert.equal(
    calls[0].init.headers['X-Elankav-Marketplace-Token'],
    undefined
  );
});

test('global OpenAI scope does not expose ELAN GO tools', () => {
  const globalTools = toolsForScope('global');
  assert.equal(globalTools.length, 2);
  assert.equal(globalTools[0].name, 'get_channel_capabilities');
  assert.equal(globalTools[1], COMMERCIAL_BRIEFING_TOOL);

  const marketplaceTools = toolsForScope('marketplace');
  assert.equal(marketplaceTools.length, 3);
  assert.equal(marketplaceTools[0], GLOBAL_CHANNEL_TOOL);
  assert.equal(marketplaceTools[1], COMMERCIAL_BRIEFING_TOOL);
  assert.equal(marketplaceTools[2], MARKETPLACE_CONTACT_TOOL);

  const serialized = JSON.stringify(globalTools);
  assert.doesNotMatch(serialized, /TOKEN|access_token|api_key|password/i);
  assert.doesNotMatch(serialized, /marketplace_contact/i);
});

test('global tool runner returns channel capabilities through function_call_output', async () => {
  const calls = [];
  const responses = [
    {
      id: 'resp-1',
      outputText: '',
      output: [{
        type: 'function_call',
        call_id: 'call-1',
        name: 'get_channel_capabilities',
        arguments: '{}'
      }]
    },
    {
      id: 'resp-2',
      outputText: 'WhatsApp está disponible globalmente.',
      output: []
    }
  ];

  const channelAdapter = {
    async getChannelCapabilities() {
      return {
        scope: 'ELANKAV_GLOBAL',
        capabilities: [{
          channel: 'whatsapp',
          state: 'VERIFIED',
          configured: true
        }]
      };
    }
  };

  const result = await runChannelToolDecision({
    input: '¿Qué canales hay disponibles?',
    scope: 'global',
    channelAdapter,
    createToolResponseImpl: async payload => {
      calls.push(payload);
      return responses.shift();
    }
  });

  assert.equal(result.outputText, 'WhatsApp está disponible globalmente.');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].previousResponseId, 'resp-1');
  const toolOutput = JSON.parse(calls[1].input[0].output);
  assert.equal(toolOutput.ok, true);
  assert.equal(toolOutput.result.scope, 'ELANKAV_GLOBAL');
  assert.equal(toolOutput.result.capabilities[0].state, 'VERIFIED');
});

test('GO execution tool is denied outside marketplace scope', async () => {
  const result = await executeChannelTool({
    name: 'execute_marketplace_contact_next',
    arguments: JSON.stringify({ case_code: 'CONTACT-ABC123' })
  }, {
    channelAdapter: {
      async getChannelCapabilities() {
        return {};
      }
    },
    marketplaceAdapter: null
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ELAN_TOOL_SCOPE_DENIED');
});


test('commercial briefing tool queries CONNECT with filters and returns auditable result', async () => {
  const calls = [];
  const adapter = createConnectChannelToolAdapter({
    env: {
      CONNECT_BASE_URL: 'https://connect.example',
      CONNECT_INTERNAL_API_TOKEN: 'SERVER_ONLY_GLOBAL_TOKEN'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        ok: true,
        counts: { total: 8, awaitingUs: 3, awaitingCustomer: 4, ownerRecommended: 1 },
        text: 'Tenés 8 conversaciones.',
        spokenText: 'Tenés 8 conversaciones.'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  const result = await adapter.getCommercialBriefing({
    channel: 'email',
    businessUnit: 'ELANVISUAL'
  });

  assert.equal(result.ok, true);
  assert.equal(result.counts.awaitingUs, 3);
  assert.match(calls[0].url, /commercial-intelligence\/briefing/);
  assert.match(calls[0].url, /channel=email/);
  assert.match(calls[0].url, /businessUnit=ELANVISUAL/);
});

test('OpenAI commercial briefing function delegates without exposing credentials', async () => {
  const result = await executeChannelTool({
    name: 'get_commercial_briefing',
    arguments: JSON.stringify({ channel: 'email', business_unit: 'ELANVISUAL' })
  }, {
    channelAdapter: {
      async getCommercialBriefing(filters) {
        assert.equal(filters.channel, 'email');
        assert.equal(filters.businessUnit, 'ELANVISUAL');
        return {
          ok: true,
          counts: { total: 5, awaitingUs: 2 },
          spokenText: 'Tenés cinco correos importantes.'
        };
      }
    },
    marketplaceAdapter: null
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.counts.awaitingUs, 2);
  assert.doesNotMatch(JSON.stringify(result), /TOKEN|password|secret/i);
});
