'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isProviderConversationEvent,
  isRegisteredProviderMessage,
  requestConversationDecision
} = require('../services/connectConversationClient');
const {
  buildProviderHistoryText,
  extractProviderName,
  findLatestProviderAudit,
  loadProviderContinuityHistory
} = require('../services/providerConversationContinuityService');

function providerAudit({ createdAt = '2026-08-18T15:31:00.000Z', item = 'los cortes de la Dra. Abigail' } = {}) {
  return {
    type: 'owner_ops_audit',
    status: 'completed',
    task: 'business.provider.message.send',
    createdAt,
    result: {
      audit: {
        capability: 'business.provider.message.send',
        success: true,
        createdAt,
        metadata: {
          providerId: 'provider-play-marketing',
          provider: 'PLAY MARKETING',
          phone: '50578727534',
          chatId: '50578727534@c.us',
          requestKind: 'status',
          item
        }
      }
    }
  };
}

test('PROVIDER-CONTINUITY-01 provider marker is recognized', () => {
  const message = '[PROVEEDOR REGISTRADO: PLAY MARKETING] Hola Buenos dias';
  assert.equal(isRegisteredProviderMessage(message), true);
  assert.equal(extractProviderName(message), 'PLAY MARKETING');
  assert.equal(isRegisteredProviderMessage('Hola, quiero un rotulo'), false);
});

test('PROVIDER-CONTINUITY-01 restores latest pending Owner request from durable audit', async () => {
  const history = await loadProviderContinuityHistory({
    message: '[PROVEEDOR REGISTRADO: PLAY MARKETING] Hola Buenos dias',
    phone: '50578727534',
    now: Date.parse('2026-08-18T16:00:00.000Z')
  }, {
    listJobsImpl: async () => [providerAudit()]
  });

  assert.equal(history.length, 1);
  assert.match(history[0].content, /PLAY MARKETING/);
  assert.match(history[0].content, /cortes de la Dra\. Abigail/i);
  assert.match(history[0].content, /pendiente de respuesta/i);
});

test('PROVIDER-CONTINUITY-01 provider decision never calls prospect decision endpoint', async () => {
  let fetchCalls = 0;
  const result = await requestConversationDecision({
    identity: '50578727534@c.us',
    platform: 'ELANVISUAL',
    message: '[PROVEEDOR REGISTRADO: PLAY MARKETING] Hola Buenos dias',
    ownerMode: false
  }, {
    fetchImpl: async () => { fetchCalls += 1; throw new Error('SHOULD_NOT_CALL_CONNECT_PROSPECT_DECISION'); },
    env: {},
    providerContinuityLoader: async () => [{
      role: 'assistant',
      content: buildProviderHistoryText(findLatestProviderAudit([providerAudit()], {
        providerName: 'PLAY MARKETING',
        phone: '50578727534',
        now: Date.parse('2026-08-18T16:00:00.000Z')
      }))
    }]
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.reason, 'registered_provider_continuity');
  assert.equal(result.welcome.send, false);
  assert.equal(result.prospect, null);
  assert.match(result.history[0].content, /Dra\. Abigail/i);
});

test('PROVIDER-CONTINUITY-01 recognized provider events cannot enter prospect conversation persistence', () => {
  assert.equal(isProviderConversationEvent({ actorType: 'provider' }), true);
  assert.equal(isProviderConversationEvent({ actorType: 'assistant', metadata: { providerMode: true } }), true);
  assert.equal(isProviderConversationEvent({ actorType: 'customer', metadata: {} }), false);
});

test('PROVIDER-CONTINUITY-01 newest matching request wins and stale unrelated request does not', () => {
  const old = providerAudit({ createdAt: '2026-08-01T12:00:00.000Z', item: 'otro trabajo' });
  const latest = providerAudit({ createdAt: '2026-08-18T15:31:00.000Z' });
  const match = findLatestProviderAudit([old, latest], {
    providerName: 'PLAY MARKETING',
    phone: '50578727534',
    now: Date.parse('2026-08-18T16:00:00.000Z')
  });
  assert.equal(match?.metadata?.item, 'los cortes de la Dra. Abigail');
});
