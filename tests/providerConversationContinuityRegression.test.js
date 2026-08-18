'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isRegisteredProviderMessage,
  requestConversationDecision
} = require('../services/connectConversationClient');
const {
  isProviderOutboundCapability,
  providerConversationText
} = require('../services/ownerOpsAuditService');

test('PROVIDER-CONTINUITY-01 provider marker is recognized', () => {
  assert.equal(isRegisteredProviderMessage('[PROVEEDOR REGISTRADO: PLAY MARKETING] Hola Buenos dias'), true);
  assert.equal(isRegisteredProviderMessage('Hola, quiero un rotulo'), false);
});

test('PROVIDER-CONTINUITY-01 provider decision suppresses any generic welcome', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        ok: true,
        action: 'RESPOND',
        reason: 'new_conversation',
        welcome: { send: true, text: 'Bienvenido a ELANVISUAL' },
        history: [
          { role: 'assistant', content: 'Solicitud enviada por Owner a PLAY MARKETING: consultar seguimiento/estado de los cortes de la Dra. Abigail. Quedamos a la espera de la respuesta del proveedor.' }
        ]
      };
    }
  });

  const result = await requestConversationDecision({
    identity: '50578727534@c.us',
    platform: 'ELANVISUAL',
    message: '[PROVEEDOR REGISTRADO: PLAY MARKETING] Hola Buenos dias',
    ownerMode: false
  }, {
    fetchImpl,
    env: { CONNECT_INTERNAL_TOKEN: 'test-token', ELANKAV_CONNECT_URL: 'https://connect.test' }
  });

  assert.equal(result.welcome.send, false);
  assert.equal(result.welcome.text, '');
  assert.equal(result.history.length, 1);
  assert.match(result.history[0].content, /cortes de la Dra\. Abigail/i);
});

test('PROVIDER-CONTINUITY-01 outbound provider operations are continuity events', () => {
  assert.equal(isProviderOutboundCapability('business.provider.message.send'), true);
  assert.equal(isProviderOutboundCapability('business.provider.quote-request.send'), true);
  assert.equal(isProviderOutboundCapability('business.customer.create'), false);
});

test('PROVIDER-CONTINUITY-01 synthetic history preserves pending subject without raw body', () => {
  const text = providerConversationText('business.provider.message.send', {
    provider: 'PLAY MARKETING',
    item: 'los cortes de la Dra. Abigail'
  });
  assert.match(text, /PLAY MARKETING/);
  assert.match(text, /cortes de la Dra\. Abigail/);
  assert.match(text, /espera de la respuesta/i);
});
