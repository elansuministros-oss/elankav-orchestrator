'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChannelDeliveryService } = require('../services/channelDeliveryService');

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    headers: { get() { return null; } }
  };
}

test('WhatsApp document delivery sends a PDF file URL through WAHA', async () => {
  let request = null;
  const service = createChannelDeliveryService({
    env: {
      WAHA_BASE_URL: 'https://waha.example',
      WAHA_API_KEY: 'test-key',
      WAHA_SESSION: 'ELANKAV'
    },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse(200, { id: { id: 'msg-file-1' } });
    }
  });

  const result = await service.deliver({
    channel: 'whatsapp',
    text: 'Cotización oficial adjunta.',
    messageType: 'file',
    phone: '50578828089',
    fileUrl: 'https://connect.elankav.com/q/test.pdf',
    fileName: 'Cotizacion-001.pdf',
    mimeType: 'application/pdf',
    caption: 'Cotización oficial adjunta.'
  });

  assert.equal(result.status, 'SENT');
  assert.equal(result.messageType, 'file');
  assert.equal(request.url, 'https://waha.example/api/sendFile');
  const body = JSON.parse(request.init.body);
  assert.equal(body.file.url, 'https://connect.elankav.com/q/test.pdf');
  assert.equal(body.file.filename, 'Cotizacion-001.pdf');
  assert.equal(body.file.mimetype, 'application/pdf');
});

test('Email delivery includes a real PDF attachment in Gmail MIME', async () => {
  const calls = [];
  const service = createChannelDeliveryService({
    env: {
      GMAIL_OAUTH_CLIENT_ID: 'client',
      GMAIL_OAUTH_CLIENT_SECRET: 'secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh',
      GMAIL_USER: 'visual@elankav.com'
    },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return jsonResponse(200, { access_token: 'access' });
      }
      if (String(url).includes('/gmail/v1/users/me/messages/send')) {
        return jsonResponse(200, { id: 'gmail-1', threadId: 'thread-1' });
      }
      throw new Error('Unexpected URL ' + url);
    }
  });

  const pdf = Buffer.from('%PDF-1.7\nELANVISUAL');
  const result = await service.deliver({
    channel: 'email',
    text: 'Adjunto la cotización oficial.',
    to: 'cliente@example.com',
    subject: 'Cotización ELANVISUAL',
    html: '<p>Adjunto la cotización oficial.</p>',
    attachments: [{
      fileName: 'Cotizacion-001.pdf',
      mimeType: 'application/pdf',
      dataBase64: pdf.toString('base64')
    }]
  });

  assert.equal(result.status, 'SENT');
  const sendCall = calls.find((call) => String(call.url).includes('/messages/send'));
  assert.ok(sendCall);
  const payload = JSON.parse(sendCall.init.body);
  const raw = Buffer.from(String(payload.raw).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(raw, /Content-Type: multipart\/mixed/);
  assert.match(raw, /Content-Disposition: attachment; filename="Cotizacion-001\.pdf"/);
  assert.match(raw, /Content-Type: application\/pdf; name="Cotizacion-001\.pdf"/);
  assert.match(raw, new RegExp(pdf.toString('base64').slice(0, 16)));
});
