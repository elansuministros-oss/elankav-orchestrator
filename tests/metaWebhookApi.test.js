'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHmac } = require('node:crypto');
const { Readable } = require('node:stream');

const {
  createMetaWebhookApi,
  normalizeMetaMessagingEvents,
  verifySignature
} = require('../api/metaWebhookApi');

function createRequest({
  method = 'GET',
  url = '/',
  headers = {},
  body = ''
} = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(value = '') {
      this.body += String(value || '');
    }
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data));
}

test('Meta webhook verification returns challenge for exact verify token', async () => {
  const handler = createMetaWebhookApi({
    env: {
      META_WEBHOOK_VERIFY_TOKEN: 'verify-123'
    }
  });

  const req = createRequest({
    method: 'GET',
    url: '/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-123&hub.challenge=CHALLENGE'
  });
  const res = createResponse();

  const handled = await handler({ req, res, sendJson });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'CHALLENGE');
});


test('Meta webhook verification rejects wrong token', async () => {
  const handler = createMetaWebhookApi({
    env: {
      META_WEBHOOK_VERIFY_TOKEN: 'verify-123'
    }
  });

  const req = createRequest({
    method: 'GET',
    url: '/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE'
  });
  const res = createResponse();

  await handler({ req, res, sendJson });

  assert.equal(res.statusCode, 403);
  assert.match(res.body, /META_WEBHOOK_VERIFICATION_FAILED/);
});


test('Meta webhook accepts signed Messenger message in receive-only mode', async () => {
  const appSecret = 'meta-app-secret';
  const payload = {
    object: 'page',
    entry: [
      {
        id: 'PAGE-1',
        time: 123456,
        messaging: [
          {
            sender: { id: 'PSID-1' },
            recipient: { id: 'PAGE-1' },
            timestamp: 123457,
            message: {
              mid: 'm_1',
              text: 'Hola desde Messenger'
            }
          }
        ]
      }
    ]
  };
  const raw = JSON.stringify(payload);
  const signature =
    'sha256=' +
    createHmac('sha256', appSecret)
      .update(Buffer.from(raw))
      .digest('hex');

  const events = [];
  const handler = createMetaWebhookApi({
    env: {
      META_APP_SECRET: appSecret
    },
    eventSink: async event => {
      events.push(event);
    }
  });

  const req = createRequest({
    method: 'POST',
    url: '/api/webhooks/meta',
    headers: {
      'x-hub-signature-256': signature
    },
    body: raw
  });
  const res = createResponse();

  await handler({ req, res, sendJson });

  assert.equal(res.statusCode, 200);
  const response = JSON.parse(res.body);
  assert.equal(response.status, 'EVENT_RECEIVED');
  assert.equal(response.mode, 'RECEIVE_ONLY');
  assert.equal(response.messagesSent, 0);
  assert.equal(response.crmWrites, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].channel, 'messenger');
  assert.equal(events[0].senderId, 'PSID-1');
  assert.equal(events[0].messageId, 'm_1');
  assert.equal(events[0].text, 'Hola desde Messenger');
});


test('Meta webhook rejects invalid signature before processing event', async () => {
  let calls = 0;
  const handler = createMetaWebhookApi({
    env: {
      META_APP_SECRET: 'meta-app-secret'
    },
    eventSink: async () => {
      calls += 1;
    }
  });

  const req = createRequest({
    method: 'POST',
    url: '/api/webhooks/meta',
    headers: {
      'x-hub-signature-256': 'sha256=bad'
    },
    body: JSON.stringify({
      object: 'page',
      entry: []
    })
  });
  const res = createResponse();

  await handler({ req, res, sendJson });

  assert.equal(res.statusCode, 401);
  assert.equal(calls, 0);
  assert.match(res.body, /META_WEBHOOK_SIGNATURE_INVALID/);
});


test('Instagram messaging webhook normalizes without causing outbound actions', () => {
  const events = normalizeMetaMessagingEvents({
    object: 'instagram',
    entry: [
      {
        id: 'IG-1',
        messaging: [
          {
            sender: { id: 'IGSID-1' },
            recipient: { id: 'IG-1' },
            message: {
              mid: 'ig-mid-1',
              text: 'Hola Instagram'
            }
          }
        ]
      }
    ]
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].channel, 'instagram_dm');
  assert.equal(events[0].senderId, 'IGSID-1');
  assert.equal(events[0].messageId, 'ig-mid-1');
});


test('signature helper validates exact X-Hub-Signature-256 digest', () => {
  const rawBody = Buffer.from('{"ok":true}');
  const appSecret = 'secret';
  const signature =
    'sha256=' +
    createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

  assert.equal(
    verifySignature({ rawBody, signature, appSecret }),
    true
  );
  assert.equal(
    verifySignature({
      rawBody,
      signature: 'sha256=invalid',
      appSecret
    }),
    false
  );
});
