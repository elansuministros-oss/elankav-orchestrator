const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CONNECT_URL,
  publishConversationEvent,
  publishUnifiedMemoryEvent,
  readUnifiedMemory,
  requestConversationDecision,
  resolveConnectUrl,
  writeUnifiedMemoryState
} = require('../services/connectConversationClient');

test('usa CONNECT oficial como URL por defecto', () => {
  assert.equal(DEFAULT_CONNECT_URL, 'https://connect.elankav.com');
  assert.equal(resolveConnectUrl({}), 'https://connect.elankav.com');
});

test('solicita a CONNECT la decisión conversacional completa', async () => {
  const calls = [];
  const result = await requestConversationDecision({ identity: '168534952960065@lid', platform: 'ELANVISUAL', message: 'Hola' }, {
    env: { ELANKAV_CONNECT_URL: 'https://connect.test', CONNECT_INTERNAL_TOKEN: 'internal-token' },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, action: 'RESPOND', welcome: { send: false } }), { status: 200 });
    }
  });
  assert.equal(result.action, 'RESPOND');
  assert.equal(calls[0].url, 'https://connect.test/api/v1/conversations/decision');
  assert.equal(JSON.parse(calls[0].options.body).identity, '168534952960065@lid');
});

test('publica evento de conversacion a CONNECT con token interno', async () => {
  const calls = [];
  const result = await publishConversationEvent({
    externalUserId: '50578828089@c.us',
    direction: 'inbound',
    text: 'hola'
  }, {
    env: {
      ELANKAV_CONNECT_URL: 'https://connect.test',
      CONNECT_INTERNAL_TOKEN: 'internal-token'
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, conversation: { id: 'c1' } }), { status: 201 });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://connect.test/api/v1/conversations/events');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer internal-token');
});


test('memoria unificada usa ELAN ONE sin redirigir decisiones de CONNECT', async () => {
  const calls = [];
  const env = {
    ELANKAV_CONNECT_URL: 'https://connect.test',
    ELAN_ONE_UNIFIED_MEMORY_BASE_URL: 'http://127.0.0.1:8098',
    CONNECT_INTERNAL_TOKEN: 'internal-token'
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes('/conversations/decision')) {
      return new Response(JSON.stringify({ ok: true, action: 'RESPOND', welcome: { send: false } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, history: [], workingState: {} }), { status: 200 });
  };

  await requestConversationDecision({ identity: 'x', platform: 'ELANVISUAL', message: 'Hola' }, { env, fetchImpl });
  await readUnifiedMemory({ actorKey: 'seller:1', actorRole: 'seller' }, { env, fetchImpl });
  await writeUnifiedMemoryState({ actorKey: 'seller:1', actorRole: 'seller', workingState: {} }, { env, fetchImpl });
  await publishUnifiedMemoryEvent({
    actorKey: 'seller:1', actorRole: 'seller', platform: 'ELANVISUAL', sourceChannel: 'whatsapp',
    direction: 'inbound', text: 'hola', messageType: 'text'
  }, { env, fetchImpl });

  assert.equal(calls[0].url, 'https://connect.test/api/v1/conversations/decision');
  assert.match(calls[1].url, /^http:\/\/127\.0\.0\.1:8098\/api\/v1\/unified-memory\?/);
  assert.equal(calls[2].url, 'http://127.0.0.1:8098/api/v1/unified-memory/state');
  assert.equal(calls[3].url, 'http://127.0.0.1:8098/api/v1/unified-memory/events');
});
