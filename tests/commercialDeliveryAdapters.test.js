'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGmailDeliveryAdapter
} = require('../adapters/gmailDeliveryAdapter');
const {
  createMetaDeliveryAdapter
} = require('../adapters/metaDeliveryAdapter');
const {
  createCommercialDeliveryService
} = require('../services/commercialDeliveryService');
const {
  authorized
} = require('../api/commercialDeliveryApi');

test('Gmail remains AUTH_REQUIRED without OAuth infrastructure', async () => {
  const adapter = createGmailDeliveryAdapter({ env: {} });
  assert.deepEqual(adapter.configuration(), {
    configured: false,
    state: 'AUTH_REQUIRED',
    reason: 'Faltan credenciales OAuth Gmail en infraestructura.'
  });
  await assert.rejects(
    adapter.probe(),
    error => error.code === 'GMAIL_AUTH_REQUIRED'
  );
});

test('Gmail sends token only to OAuth/Gmail endpoints and preserves threadId', async () => {
  const calls = [];
  const adapter = createGmailDeliveryAdapter({
    env: {
      GMAIL_OAUTH_CLIENT_ID: 'client-id',
      GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh-token',
      GMAIL_USER: 'elan@example.com'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ACCESS-TOKEN' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ id: 'MSG-1', threadId: 'THREAD-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  const result = await adapter.sendText({
    to: 'buyer@example.com',
    subject: 'RFQ',
    text: 'Mensaje comercial',
    threadId: 'THREAD-1'
  });

  assert.deepEqual(result, {
    status: 'SENT',
    id: 'MSG-1',
    threadId: 'THREAD-1'
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].init.body, /refresh_token=refresh-token/);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer ACCESS-TOKEN');
  assert.doesNotMatch(JSON.stringify(calls[1].init.body), /client-secret|refresh-token/);
});

test('Messenger requires a scoped recipient and uses Page messages endpoint', async () => {
  const calls = [];
  const adapter = createMetaDeliveryAdapter({
    env: {
      META_GRAPH_API_VERSION: 'v99.0',
      META_PAGE_ID: 'PAGE-1',
      META_PAGE_ACCESS_TOKEN: 'PAGE-TOKEN'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        recipient_id: 'PSID-1',
        message_id: 'MID-1'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  await assert.rejects(
    adapter.sendMessengerText({ recipientId: '', text: 'Hola' }),
    error => error.code === 'META_ARGUMENT_REQUIRED'
  );

  const result = await adapter.sendMessengerText({
    recipientId: 'PSID-1',
    text: 'Hola',
    messageType: 'RESPONSE'
  });

  assert.equal(calls[0].url, 'https://graph.facebook.com/v99.0/PAGE-1/messages');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer PAGE-TOKEN');
  assert.match(calls[0].init.body, /"message_type":"RESPONSE"/);
  assert.equal(result.messageId, 'MID-1');
});

test('Instagram requires IGSID and uses graph.instagram.com messages endpoint', async () => {
  const calls = [];
  const adapter = createMetaDeliveryAdapter({
    env: {
      META_GRAPH_API_VERSION: 'v99.0',
      META_INSTAGRAM_ACCOUNT_ID: 'IG-ACCOUNT-1',
      INSTAGRAM_ACCESS_TOKEN: 'IG-TOKEN'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        recipient_id: 'IGSID-1',
        message_id: 'IG-MID-1'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  const result = await adapter.sendInstagramText({
    recipientId: 'IGSID-1',
    text: 'Hola'
  });

  assert.equal(
    calls[0].url,
    'https://graph.instagram.com/v99.0/IG-ACCOUNT-1/messages'
  );
  assert.equal(calls[0].init.headers.Authorization, 'Bearer IG-TOKEN');
  assert.equal(result.messageId, 'IG-MID-1');
});


test('commercial delivery API requires the server internal token', () => {
  const env = { ORCHESTRATOR_INTERNAL_TOKEN: 'INTERNAL-ONLY' };
  assert.equal(authorized({
    headers: { authorization: 'Bearer INTERNAL-ONLY' }
  }, env), true);
  assert.equal(authorized({
    headers: { authorization: 'Bearer WRONG' }
  }, env), false);
  assert.equal(authorized({
    headers: {}
  }, env), false);
});

test('commercial runtime refuses Meta delivery without verified target evidence', async () => {
  let externalCalls = 0;
  const service = createCommercialDeliveryService({
    env: {
      META_GRAPH_API_VERSION: 'v99.0',
      META_PAGE_ID: 'PAGE-1',
      META_PAGE_ACCESS_TOKEN: 'PAGE-TOKEN'
    },
    fetchImpl: async () => {
      externalCalls += 1;
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  await assert.rejects(
    service.deliver({
      channel: 'messenger',
      recipientId: 'PSID-1',
      text: 'Hola',
      verifiedTarget: false
    }),
    error => error.code === 'MESSENGER_TARGET_NOT_VERIFIED'
  );
  assert.equal(externalCalls, 0);
});

test('commercial capability snapshot does not mark Gmail or Meta VERIFIED from env alone', () => {
  const service = createCommercialDeliveryService({
    env: {
      WAHA_BASE_URL: 'https://waha.example',
      WAHA_API_KEY: 'WAHA-KEY',
      GMAIL_OAUTH_CLIENT_ID: 'client',
      GMAIL_OAUTH_CLIENT_SECRET: 'secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh',
      GMAIL_USER: 'elan@example.com',
      META_GRAPH_API_VERSION: 'v99.0',
      META_PAGE_ID: 'PAGE-1',
      META_PAGE_ACCESS_TOKEN: 'PAGE-TOKEN',
      META_INSTAGRAM_ACCOUNT_ID: 'IG-1'
    }
  });

  const snapshot = service.capabilitySnapshot();
  assert.equal(snapshot.find(item => item.channel === 'whatsapp').state, 'VERIFIED');
  assert.equal(snapshot.find(item => item.channel === 'email').state, 'AUTH_REQUIRED');
  assert.equal(snapshot.find(item => item.channel === 'messenger').state, 'AUTH_REQUIRED');
  assert.equal(snapshot.find(item => item.channel === 'instagram_dm').state, 'AUTH_REQUIRED');
});
