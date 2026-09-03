'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LangflowPlannerService,
  buildPlannerFlow,
  parsePlannerJson,
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
  assert.deepEqual(model.data.node.template.model.value, [{
    name: 'gpt-5.6-sol',
    provider: 'OpenAI',
    category: 'OpenAI',
    metadata: {}
  }]);
  assert.equal(model.data.node.template.temperature.value, 0);
  assert.match(prompt.data.node.template.template.value, /nunca ejecutes acciones/i);
  assert.equal(input.data.node.template.should_store_message.value, false);
  assert.equal(output.data.node.template.should_store_message.value, false);
});

test('planner validates tool choice against the Orchestrator manifest', () => {
  const plan = validatePlan(
    parsePlannerJson('{"tool":"buscar_material_catalogo","arguments":{"query":"acrilico"},"confidence":0.91,"reason":"material"}'),
    [{ name: 'buscar_material_catalogo' }]
  );
  assert.equal(plan.tool, 'buscar_material_catalogo');
  assert.deepEqual(plan.arguments, { query: 'acrilico' });
  assert.equal(plan.confidence, 0.91);

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
                text: '{"tool":"buscar_material_catalogo","arguments":{"query":"acrilico","platform":"ELANVISUAL"},"confidence":0.97,"reason":"consulta de material"}'
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
    allowedTools: [{
      name: 'buscar_material_catalogo',
      description: 'Busca materiales',
      parameters: { type: 'object' }
    }]
  });

  assert.equal(result.available, true);
  assert.equal(result.plan.tool, 'buscar_material_catalogo');
  assert.deepEqual(result.plan.arguments, { query: 'acrilico', platform: 'ELANVISUAL' });
  assert.ok(calls.some(call => call.url.endsWith('/api/v1/login')));
  assert.ok(calls.some(call => call.url.endsWith('/api/v1/api_key/')));
  assert.ok(calls.some(call => call.url.endsWith('/api/v1/run/planner-flow-1')));
  assert.ok(savedState.includes('"flowId": "planner-flow-1"'));

  const runCall = calls.find(call => call.url.endsWith('/api/v1/run/planner-flow-1'));
  assert.equal(runCall.headers['x-api-key'], 'runtime-key');
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
