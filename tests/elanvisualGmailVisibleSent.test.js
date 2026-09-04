'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChannelDeliveryService } = require('../services/channelDeliveryService');

test('ELANVISUAL uses Gmail when Gmail and Resend are both configured', async () => {
  const calls = [];
  const service = createChannelDeliveryService({
    env: {
      GMAIL_OAUTH_CLIENT_ID: 'client-id',
      GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh-token',
      GMAIL_USER: 'elan@elankav.com',
      GMAIL_SENDER_IDENTITIES_JSON: JSON.stringify({ elanvisual: 'visual@elankav.com' }),
      RESEND_API_KEY: 're_test_key',
      RESEND_DOMAIN_VERIFIED: 'true'
    },
    fetchImpl: async (url, init) => {
      const target = String(url);
      calls.push({ target, init });
      if (target.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ACCESS-TOKEN' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (target.includes('gmail.googleapis.com/gmail/v1/users/me/messages/send')) {
        return new Response(JSON.stringify({ id: 'GMAIL-MSG-1', threadId: 'THREAD-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (target.includes('api.resend.com/emails')) {
        return new Response(JSON.stringify({ id: 'RESEND-MSG-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`unexpected URL: ${target}`);
    }
  });

  const result = await service.deliver({
    channel: 'email',
    to: 'cliente@example.com',
    subject: 'Presentación ELANVISUAL',
    text: 'Mensaje comercial',
    html: '<p>Mensaje comercial</p>',
    fromIdentity: 'elanvisual'
  });

  assert.equal(result.status, 'SENT');
  assert.equal(result.provider, 'gmail');
  assert.equal(result.externalRef, 'GMAIL-MSG-1');
  assert.equal(calls.some(call => call.target.includes('gmail.googleapis.com/gmail/v1/users/me/messages/send')), true);
  assert.equal(calls.some(call => call.target.includes('api.resend.com/emails')), false);
});

test('ELANVISUAL falls back to Resend only when Gmail is not configured', async () => {
  const calls = [];
  const service = createChannelDeliveryService({
    env: {
      RESEND_API_KEY: 're_test_key',
      RESEND_DOMAIN_VERIFIED: 'true'
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: 'RESEND-MSG-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  const result = await service.deliver({
    channel: 'email',
    to: 'cliente@example.com',
    subject: 'Presentación ELANVISUAL',
    text: 'Mensaje comercial',
    fromIdentity: 'elanvisual'
  });

  assert.equal(result.provider, 'resend');
  assert.equal(calls.some(url => url.includes('api.resend.com/emails')), true);
});
