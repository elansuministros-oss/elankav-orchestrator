'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshService(env = {}) {
  for (const key of ['ELAN_ONE_COMMERCIAL_BASE_URL','ELAN_ONE_ACTOR_IDENTITY_BASE_URL','ELAN_ONE_UNIFIED_MEMORY_BASE_URL','ELAN_ONE_VQS_API_TOKEN','VQS_API_TOKEN','DESIGN_API_TOKEN','CONNECT_INTERNAL_API_TOKEN']) delete process.env[key];
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../services/connectPlatformKnowledgeService')];
  return require('../services/connectPlatformKnowledgeService');
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const emptyConnect = { platform: 'ELANVISUAL', platformId: 'elanvisual', identity: [], rules: [], knowledge: [] };

test('usa ELAN ONE solo cuando CONNECT queda sin producto válido', async () => {
  const svc = freshService({ ELAN_ONE_COMMERCIAL_BASE_URL: 'http://127.0.0.1:8098', ELAN_ONE_VQS_API_TOKEN: 'test-token', CONNECT_INTERNAL_API_TOKEN: 'connect-token' });
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return response(emptyConnect);
    return response({ data: { status: 'MULTIPLE', clarificationType: 'PRINT_TECHNOLOGY', matches: [
      { id: 'roland-uv-lona-mesh', name: 'Lona mesh — mesh', formulaType: 'AREA_M2', currency: 'USD', pricePerM2: 14 },
      { id: 'epson-eco-lona-mesh', name: 'Lona mesh — mesh', formulaType: 'AREA_M2', currency: 'USD', pricePerM2: 11 }
    ] } });
  };
  const result = await svc.fetchPlatformKnowledge({ platform: 'elanvisual', query: 'lona mesh', fetchFn });
  assert.equal(calls.length, 2);
  assert.equal(result.payload.knowledge.length, 2);
  assert.deepEqual(result.payload.knowledge.map(x => x.data.pricePerM2), [14, 11]);
  assert.equal(result.payload.commercialResolution.status, 'MULTIPLE');
});

test('NOT_FOUND de ELAN ONE permanece sin precio ni producto inventado', async () => {
  const svc = freshService({ ELAN_ONE_COMMERCIAL_BASE_URL: 'http://127.0.0.1:8098', ELAN_ONE_VQS_API_TOKEN: 'test-token', CONNECT_INTERNAL_API_TOKEN: 'connect-token' });
  let call = 0;
  const fetchFn = async () => ++call === 1 ? response(emptyConnect) : response({ data: { status: 'NOT_FOUND', matches: [] } });
  const result = await svc.fetchPlatformKnowledge({ platform: 'elanvisual', query: 'pintura de avion', fetchFn });
  assert.deepEqual(result.payload.knowledge, []);
});

test('si CONNECT ya tiene coincidencia válida no consulta ELAN ONE', async () => {
  const svc = freshService({ ELAN_ONE_COMMERCIAL_BASE_URL: 'http://127.0.0.1:8098', ELAN_ONE_VQS_API_TOKEN: 'test-token', CONNECT_INTERNAL_API_TOKEN: 'connect-token' });
  let calls = 0;
  const fetchFn = async () => { calls += 1; return response({ ...emptyConnect, knowledge: [{ id: 'frost', title: 'Vinil frost con impresión UV', tags: ['frost'], data: { name: 'Vinil frost con impresión UV', pricePerM2: 25 } }] }); };
  const result = await svc.fetchPlatformKnowledge({ platform: 'elanvisual', query: 'precio frost', fetchFn });
  assert.equal(calls, 1);
  assert.equal(result.payload.knowledge[0].id, 'frost');
});

test('falla del fallback no tumba el conocimiento de CONNECT', async () => {
  const svc = freshService({ ELAN_ONE_COMMERCIAL_BASE_URL: 'http://127.0.0.1:8098', ELAN_ONE_VQS_API_TOKEN: 'test-token', CONNECT_INTERNAL_API_TOKEN: 'connect-token' });
  let call = 0;
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await svc.fetchPlatformKnowledge({ platform: 'elanvisual', query: 'lona mesh', fetchFn: async () => ++call === 1 ? response(emptyConnect) : response({ error: { code: 'FAIL' } }, 503) });
    assert.deepEqual(result.payload.knowledge, []);
    assert.equal(result.available, true);
  } finally { console.error = originalError; }
});
