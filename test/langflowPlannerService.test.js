'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LangflowPlannerService,
  buildPlannerFlow,
  parsePlannerJson,
  validateComposedReply,
  validatePlan
} = require('../services/langflowPlannerService');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

function minimalBasicPrompting() {
  return {
    name: 'Basic Prompting',
    data: {
      edges: [],
      nodes: [
        {
          data: {
            type: 'ChatInput',
            node: { template: { should_store_message: { value: true } } }
          }
        },
        {
          data: {
            type: 'Prompt',
            node: { template: { template: { value: 'old prompt' } } }
          }
        },
        {
          data: {
            type: 'LanguageModelComponent',
            node: {
              template: {
                model: { value: '' },
                temperature: { value: 0.8 }
              }
            }
          }
        },
        {
          data: {
            type: 'ChatOutput',
            node: { template: { should_store_message: { value: true } } }
          }
        }
      ]
    }
  };
}

test('planner flow is tool-free, stateless and pinned to the configured OpenAI model', () => {
  const flow = buildPlannerFlow(minimalBasicPrompting());
  const nodes = flow.data.nodes;
  const model = nodes.find(node => node.data.type === 'LanguageModelComponent');
  const prompt = nodes.find(node => node.data.type === 'Prompt');
  const input = nodes.find(node => node.data.type === 'ChatInput');
  const output = nodes.find(node => node.data.type === 'ChatOutput');

  assert.equal(flow.endpoint_name, 'elan-semantic-planner');
  assert.equal(flow.name, 'ELAN Conversation Brain');
  assert.equal(flow.description, 'ELANKAV_CONVERSATION_BRAIN:1.2.0');
  assert.deepEqual(model.data.node.template.model.value, [{
    name: 'gpt-5.6-sol',
    provider: 'OpenAI',
    category: 'OpenAI',
    metadata: {}
  }]);
  assert.equal(model.data.node.template.temperature.value, 0);
  assert.match(prompt.data.node.template.template.value, /nunca ejecutes acciones/i);
  assert.match(prompt.data.node.template.template.value, /qué proveedor tiene, vende o suministra/i);
  assert.match(prompt.data.node.template.template.value, /buscar_material_catalogo/i);
  assert.match(prompt.data.node.template.template.value, /TASK=compose/i);
  assert.match(prompt.data.node.template.template.value, /máximo una pregunta/i);
  assert.match(prompt.data.node.template.template.value, /no inventar precios/i);
  assert.equal(input.data.node.template.should_store_message.value, false);
  assert.equal(output.data.node.template.should_store_message.value, false);
});

test('planner validates tool choice against the Orchestrator manifest', () => {
  const plan = validatePlan(
    parsePlannerJson('{"tool":"buscar_material_catalogo","arguments":{"query":"acrilico"},"confidence":0.91,"reason":"material","state_patch":{"product":"acrílico","quantity":2,"unknown":"drop"}}'),
    [{ name: 'buscar_material_catalogo' }]
  );
  assert.equal(plan.tool, 'buscar_material_catalogo');
  assert.deepEqual(plan.arguments, { query: 'acrilico' });
  assert.equal(plan.confidence, 0.91);
  assert.deepEqual(plan.statePatch, { product: 'acrílico', quantity: 2 });

  assert.throws(
    () => validatePlan({ tool: 'enviar_mensaje_whatsapp', arguments: {} }, [{ name: 'buscar_material_catalogo' }]),
    error => error?.code === 'LANGFLOW_PLANNER_TOOL_NOT_ALLOWED'
  );
});

test('planner bootstraps Langflow internally and runs without a user tunnel', async () => {
  const calls = [];
  let savedState = '';
  const fakeFs = {
    async readFile(file) {
      if (String(file).endsWith('langflow.env')) {
        return 'LANGFLOW_SUPERUSER=elan-admin\nLANGFLOW_SUPERUSER_PASSWORD=local-secret\n';
      }
      if (String(file).endsWith('planner.json') && savedState) return savedState;
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    async mkdir() {},
    async writeFile(_file, content) { savedState = content; },
    async rename() {},
    async unlink() { savedState = ''; }
  };

  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body || '' });

    if (url.endsWith('/api/v1/login')) return response(200, { access_token: 'jwt-token' });
    if (url.endsWith('/api/v1/flows/')) {
      if ((options.method || 'GET') === 'POST') return response(201, { id: 'planner-flow-1', endpoint_name: 'elan-semantic-planner' });
      return response(200, []);
    }
    if (url.endsWith('/api/v1/flows/basic_examples/')) return response(200, [minimalBasicPrompting()]);
    if (url.endsWith('/api/v1/api_key/')) return response(200, { api_key: 'runtime-key' });
    if (url.endsWith('/api/v1/run/planner-flow-1')) {
      return response(200, {
        outputs: [{
          outputs: [{
            results: {
              message: {
                text: '{"tool":"buscar_material_catalogo","arguments":{"query":"acrilico","platform":"ELANVISUAL"},"confidence":0.97,"reason":"consulta de material","state_patch":{"product":"acrílico","status":"CONSULTANDO"}}'
              }
            }
          }]
        }]
      });
    }
    return response(404, { error: 'unexpected' });
  };

  const service = new LangflowPlannerService({
    fetchImpl: fakeFetch,
    fsImpl: fakeFs,
    baseUrl: 'http://127.0.0.1:7860',
    envPath: '/var/lib/elankav-langflow/langflow.env',
    statePath: '/tmp/planner.json'
  });

  const result = await service.plan({
    message: 'Buscá materiales de acrílico',
    actor: { role: 'owner', actorId: 'owner' },
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    history: [],
    workingState: { activeCustomerReference: 'CLIENTE A' },
    allowedTools: [{
      name: 'buscar_material_catalogo',
      description: 'Busca materiales',
      parameters: { type: 'object' }
    }]
  });

  assert.equal(result.available, true);
  assert.equal(result.plan.tool, 'buscar_material_catalogo');
  assert.deepEqual(result.plan.arguments, { query: 'acrilico', platform: 'ELANVISUAL' });
  assert.deepEqual(result.plan.statePatch, { product: 'acrílico', status: 'CONSULTANDO' });
  assert.ok(calls.some(call => call.url.endsWith('/api/v1/login')));
  assert.ok(calls.some(call => call.url.endsWith('/api/v1/api_key/')));
  assert.ok(calls.some(call => call.url.endsWith('/api/v1/run/planner-flow-1')));
  assert.ok(savedState.includes('"flowId": "planner-flow-1"'));

  const runCall = calls.find(call => call.url.endsWith('/api/v1/run/planner-flow-1'));
  assert.equal(runCall.headers['x-api-key'], 'runtime-key');
  assert.match(runCall.body, /"task":"plan"/);
  assert.match(runCall.body, /"activeCustomerReference":"CLIENTE A"/);
});


test('planner upgrades an existing persisted flow automatically without user PC', async () => {
  const calls = [];
  const existingFlow = {
    id: 'planner-existing',
    name: 'ELAN Semantic Planner',
    endpoint_name: 'elan-semantic-planner',
    description: 'ELANKAV_ORCHESTRATOR_PLANNER:1.0.0',
    ...minimalBasicPrompting()
  };
  let savedState = JSON.stringify({
    version: '1.0.0',
    flowId: 'planner-existing',
    endpointName: 'elan-semantic-planner',
    apiKey: 'runtime-key-old',
    createdAt: '2026-09-02T00:00:00.000Z'
  });
  const fakeFs = {
    async readFile(file) {
      if (String(file).endsWith('langflow.env')) {
        return 'LANGFLOW_SUPERUSER=elan-admin\nLANGFLOW_SUPERUSER_PASSWORD=local-secret\n';
      }
      if (String(file).endsWith('planner.json')) return savedState;
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    async mkdir() {},
    async writeFile(_file, content) { savedState = content; },
    async rename() {},
    async unlink() {}
  };

  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body || '' });
    if (url.endsWith('/api/v1/login')) return response(200, { access_token: 'jwt-token' });
    if (url.endsWith('/api/v1/flows/')) return response(200, [existingFlow]);
    if (url.endsWith('/api/v1/flows/planner-existing') && options.method === 'PATCH') {
      return response(200, { ...existingFlow, name: 'ELAN Conversation Brain', description: 'ELANKAV_CONVERSATION_BRAIN:1.2.0' });
    }
    return response(404, { error: 'unexpected' });
  };

  const service = new LangflowPlannerService({
    fetchImpl: fakeFetch,
    fsImpl: fakeFs,
    baseUrl: 'http://127.0.0.1:7860',
    envPath: '/var/lib/elankav-langflow/langflow.env',
    statePath: '/tmp/planner.json'
  });

  const state = await service.bootstrap();
  assert.equal(state.version, '1.2.0');
  assert.equal(state.apiKey, 'runtime-key-old');
  const patchCall = calls.find(call => call.url.endsWith('/api/v1/flows/planner-existing') && call.method === 'PATCH');
  assert.ok(patchCall);
  assert.match(patchCall.body, /ELANKAV_ORCHESTRATOR_PLANNER:1\.1\.0/);
  assert.match(patchCall.body, /buscar_material_catalogo/);
});


test('conversation brain composes a natural reply without changing the approved facts', async () => {
  const calls = [];
  const fakeFs = {
    async readFile(file) {
      if (String(file).endsWith('planner.json')) {
        return JSON.stringify({
          version: '1.2.0',
          flowId: 'planner-flow-1',
          endpointName: 'elan-semantic-planner',
          apiKey: 'runtime-key'
        });
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    async mkdir() {},
    async writeFile() {},
    async rename() {},
    async unlink() {}
  };

  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body || '' });
    if (url.endsWith('/api/v1/run/planner-flow-1')) {
      return response(200, {
        outputs: [{
          outputs: [{
            results: {
              message: {
                text: '{"reply":"No encontré ese proveedor por ese nombre. ¿Querés que lo busque por teléfono?"}'
              }
            }
          }]
        }]
      });
    }
    return response(404, {});
  };

  const service = new LangflowPlannerService({
    fetchImpl: fakeFetch,
    fsImpl: fakeFs,
    statePath: '/tmp/planner.json'
  });

  const result = await service.composeReply({
    message: 'busca proveedor pepito',
    approvedReply: 'No encontré registros que coincidan.',
    actor: { role: 'owner', actorId: 'owner' },
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    workingState: { customerReference: 'ACME' }
  });

  assert.equal(result.available, true);
  assert.equal(result.reply, 'No encontré ese proveedor por ese nombre. ¿Querés que lo busque por teléfono?');
  const runCall = calls.find(call => call.url.endsWith('/api/v1/run/planner-flow-1'));
  assert.ok(runCall);
  assert.match(runCall.body, /"task":"compose"/);
  assert.match(runCall.body, /No encontré registros que coincidan/);
  assert.equal(validateComposedReply({ reply: '' }, 'fallback'), 'fallback');
});

test('planner fails open when Langflow bootstrap is unavailable', async () => {
  const service = new LangflowPlannerService({
    fetchImpl: async () => { throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }); },
    fsImpl: {
      async readFile() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }
    },
    statePath: '/tmp/missing-planner.json'
  });

  const result = await service.plan({
    message: 'busca acrilico',
    actor: { role: 'owner' },
    allowedTools: [{ name: 'buscar_material_catalogo' }]
  });

  assert.equal(result.available, false);
  assert.ok(result.errorCode);
});
