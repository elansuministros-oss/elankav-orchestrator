'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createResendDeliveryAdapter } = require('../adapters/resendDeliveryAdapter');
const { createGmailDeliveryAdapter } = require('../adapters/gmailDeliveryAdapter');

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

test('Resend transporta HTML junto al fallback texto', async () => {
  let captured = null;
  const adapter = createResendDeliveryAdapter({
    env: {
      RESEND_API_KEY: 're_test',
      RESEND_DOMAIN_VERIFIED: 'true'
    },
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() { return { id: 'email-resend-1' }; }
      };
    }
  });

  const result = await adapter.sendText({
    to: 'marketing@example.com',
    subject: 'Presentación',
    text: 'Versión texto',
    html: '<html><body><strong>ELANVISUAL</strong></body></html>',
    fromIdentity: 'elanvisual'
  });

  assert.equal(result.id, 'email-resend-1');
  assert.equal(captured.text, 'Versión texto');
  assert.match(captured.html, /ELANVISUAL/);
  assert.match(captured.from, /visual@elankav.com/);
});

test('Gmail genera multipart alternative cuando recibe HTML', async () => {
  let raw = '';
  const adapter = createGmailDeliveryAdapter({
    env: {
      GMAIL_OAUTH_CLIENT_ID: 'client',
      GMAIL_OAUTH_CLIENT_SECRET: 'secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh',
      GMAIL_USER: 'visual@elankav.com'
    },
    fetchImpl: async (url, init) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          status: 200,
          async json() { return { access_token: 'token' }; }
        };
      }
      const payload = JSON.parse(init.body);
      raw = decodeBase64Url(payload.raw);
      return {
        ok: true,
        status: 200,
        async json() { return { id: 'gmail-1', threadId: 'thread-1' }; }
      };
    }
  });

  const result = await adapter.sendText({
    to: 'compras@example.com',
    subject: 'ELANVISUAL',
    text: 'Texto alternativo',
    html: '<html><body><h1>ELANVISUAL</h1></body></html>'
  });

  assert.equal(result.id, 'gmail-1');
  assert.match(raw, /multipart\/alternative/);
  assert.match(raw, /Texto alternativo/);
  assert.match(raw, /<h1>ELANVISUAL<\/h1>/);
});
