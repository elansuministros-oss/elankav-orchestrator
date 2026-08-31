'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGmailDeliveryAdapter
} = require('../adapters/gmailDeliveryAdapter');
const {
  createResendDeliveryAdapter
} = require('../adapters/resendDeliveryAdapter');
const {
  createMetaDeliveryAdapter
} = require('../adapters/metaDeliveryAdapter');
const {
  createChannelDeliveryService
} = require('../services/channelDeliveryService');
const {
  authorized,
  configuredToken,
  configuredTokens,
  deriveChannelInternalToken
} = require('../api/channelDeliveryApi');

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


test('Gmail sender identities are server-allowlisted and cannot be invented by a platform', async () => {
  const calls = [];
  const adapter = createGmailDeliveryAdapter({
    env: {
      GMAIL_OAUTH_CLIENT_ID: 'client-id',
      GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh-token',
      GMAIL_USER: 'elan@elankav.com',
      GMAIL_SENDER_IDENTITIES_JSON: JSON.stringify({
        elanvisual: 'visual@elankav.com',
        'elan-go': 'go@elankav.com'
      })
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ACCESS-TOKEN' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ id: 'MSG-ALIAS', threadId: 'THREAD-ALIAS' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  await adapter.sendText({
    to: 'cliente@example.com',
    subject: 'Cotización',
    text: 'Mensaje',
    fromIdentity: 'elanvisual'
  });

  const gmailRequest = calls.find(call =>
    call.url.includes('gmail.googleapis.com/gmail/v1/users/me/messages/send')
  );
  assert.ok(gmailRequest);
  const requestPayload = JSON.parse(gmailRequest.init.body);
  const normalized = requestPayload.raw
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const mime = Buffer.from(normalized + padding, 'base64').toString('utf8');
  assert.match(mime, /^From: visual@elankav\.com\r?$/m);

  const callsBeforeRejectedIdentity = calls.length;
  await assert.rejects(
    adapter.sendText({
      to: 'cliente@example.com',
      subject: 'No autorizado',
      text: 'Mensaje',
      fromIdentity: 'inventado'
    }),
    error => error.code === 'GMAIL_SENDER_IDENTITY_NOT_ALLOWED'
  );
  assert.equal(calls.length, callsBeforeRejectedIdentity);
});


test('Gmail probe requires configured Workspace send-as identities to be accepted', async () => {
  let tokenCalls = 0;
  const adapter = createGmailDeliveryAdapter({
    env: {
      GMAIL_OAUTH_CLIENT_ID: 'client-id',
      GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh-token',
      GMAIL_USER: 'elan@elankav.com',
      GMAIL_SENDER_IDENTITIES_JSON: JSON.stringify({
        elanvisual: 'visual@elankav.com',
        'elan-go': 'go@elankav.com'
      })
    },
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('oauth2.googleapis.com/token')) {
        tokenCalls += 1;
        return new Response(JSON.stringify({ access_token: `ACCESS-${tokenCalls}` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (target.endsWith('/profile')) {
        return new Response(JSON.stringify({
          emailAddress: 'elan@elankav.com',
          messagesTotal: 10,
          threadsTotal: 5
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (target.endsWith('/settings/sendAs')) {
        return new Response(JSON.stringify({
          sendAs: [
            {
              sendAsEmail: 'visual@elankav.com',
              verificationStatus: 'accepted'
            },
            {
              sendAsEmail: 'go@elankav.com',
              verificationStatus: 'pending'
            }
          ]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`unexpected Gmail URL: ${target}`);
    }
  });

  const probe = await adapter.probe();
  assert.equal(probe.state, 'AUTH_REQUIRED');
  assert.deepEqual(probe.senderIdentities, [
    {
      identity: 'elanvisual',
      address: 'visual@elankav.com',
      verified: true,
      verificationStatus: 'accepted'
    },
    {
      identity: 'elan-go',
      address: 'go@elankav.com',
      verified: false,
      verificationStatus: 'pending'
    }
  ]);
});

test('Resend only allows ELANVISUAL and ELAN GO sender identities by default', async () => {
  const calls = [];
  const adapter = createResendDeliveryAdapter({
    env: {
      RESEND_API_KEY: 're_test_key',
      RESEND_DOMAIN_VERIFIED: 'true'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: 'resend-msg-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  const visual = await adapter.sendText({
    to: 'cliente@example.com',
    subject: 'Cotización',
    text: 'Mensaje',
    fromIdentity: 'elanvisual'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_key');

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.from, 'ELANVISUAL <visual@elankav.com>');
  assert.deepEqual(body.to, ['cliente@example.com']);
  assert.equal(visual.id, 'resend-msg-1');
  assert.equal(visual.sender, 'visual@elankav.com');

  const beforeRejected = calls.length;
  await assert.rejects(
    adapter.sendText({
      to: 'cliente@example.com',
      subject: 'No autorizado',
      text: 'Mensaje',
      fromIdentity: 'inventado'
    }),
    error => error.code === 'RESEND_SENDER_IDENTITY_NOT_ALLOWED'
  );
  assert.equal(calls.length, beforeRejected);
});


test('Resend supports ELAN GO identity and reply headers', async () => {
  let payload;
  const adapter = createResendDeliveryAdapter({
    env: {
      RESEND_API_KEY: 're_test_key',
      RESEND_DOMAIN_VERIFIED: 'true'
    },
    fetchImpl: async (_url, init) => {
      payload = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: 'resend-msg-go' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  await adapter.sendText({
    to: 'buyer@example.com',
    subject: 'Seguimiento',
    text: 'Mensaje GO',
    fromIdentity: 'elan-go',
    inReplyTo: '<message-1@example.com>',
    references: '<message-1@example.com>'
  });

  assert.equal(payload.from, 'ELAN GO <go@elankav.com>');
  assert.equal(payload.headers['In-Reply-To'], '<message-1@example.com>');
  assert.equal(payload.headers.References, '<message-1@example.com>');
});


test('global email capability becomes VERIFIED for configured verified Resend domain', () => {
  const service = createChannelDeliveryService({
    env: {
      WAHA_API_KEY: 'WAHA-KEY',
      RESEND_API_KEY: 're_test_key',
      RESEND_DOMAIN_VERIFIED: 'true'
    }
  });

  const email = service
    .capabilitySnapshot()
    .find(item => item.channel === 'email');

  assert.equal(email.provider, 'resend');
  assert.equal(email.configured, true);
  assert.equal(email.state, 'VERIFIED');
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


test('channel delivery API requires the server internal token', () => {
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


test('channel delivery API derives a dedicated bridge token from VQS root secret when no dedicated token exists', () => {
  const env = { VQS_API_TOKEN: 'V'.repeat(40) };
  const derived = deriveChannelInternalToken(env.VQS_API_TOKEN);

  assert.equal(derived.length, 64);
  assert.notEqual(derived, env.VQS_API_TOKEN);
  assert.equal(configuredToken(env), derived);
  assert.equal(authorized({
    headers: { 'x-elankav-internal-token': derived }
  }, env), true);
  assert.equal(authorized({
    headers: { 'x-elankav-internal-token': env.VQS_API_TOKEN }
  }, env), false);
});

test('channel delivery API accepts both dedicated and derived bridge tokens during transition', () => {
  const env = {
    ORCHESTRATOR_INTERNAL_TOKEN: 'DEDICATED-INTERNAL-TOKEN-123456',
    VQS_API_TOKEN: 'V'.repeat(40)
  };
  const derived = deriveChannelInternalToken(env.VQS_API_TOKEN);
  const tokens = configuredTokens(env);

  assert.equal(tokens.includes(env.ORCHESTRATOR_INTERNAL_TOKEN), true);
  assert.equal(tokens.includes(derived), true);
  assert.equal(authorized({
    headers: { 'x-elankav-internal-token': env.ORCHESTRATOR_INTERNAL_TOKEN }
  }, env), true);
  assert.equal(authorized({
    headers: { 'x-elankav-internal-token': derived }
  }, env), true);
  assert.equal(authorized({
    headers: { 'x-elankav-internal-token': 'WRONG' }
  }, env), false);
});


test('channel runtime refuses Meta delivery without verified target evidence', async () => {
  let externalCalls = 0;
  const service = createChannelDeliveryService({
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

test('global channel capability snapshot does not mark Gmail or Meta VERIFIED from env alone', () => {
  const service = createChannelDeliveryService({
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
