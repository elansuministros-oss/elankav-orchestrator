'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const {
  handleWahaWebhookApi,
  normalizeInbound
} = require('../api/wahaWebhookApi');

function createRequest({
  method = 'POST',
  url = '/webhook/inbound',
  headers = { 'content-type': 'application/json', host: 'localhost' },
  body = {}
} = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    }
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.payload = payload;
}

test('normaliza payload estándar de WAHA', () => {
  const inbound = normalizeInbound({
    event: 'message',
    session: 'ELANKAV',
    payload: {
      id: { id: 'msg-001' },
      from: '50578828089@c.us',
      body: 'Necesito una cotización'
    }
  });

  assert.equal(inbound.chatId, '50578828089@c.us');
  assert.equal(inbound.phone, '50578828089');
  assert.equal(inbound.text, 'Necesito una cotización');
  assert.equal(inbound.eventId, 'msg-001');
  assert.equal(inbound.session, 'ELANKAV');
});

test('procesa mensaje inbound y envía la respuesta por WAHA', async () => {
  const calls = { process: [], delivery: [] };
  const req = createRequest({
    body: {
      event: 'message',
      session: 'ELANKAV',
      payload: {
        id: { id: 'msg-002' },
        from: '50578828089@c.us',
        fromMe: false,
        body: 'Hola'
      }
    }
  });
  const res = createResponse();

  const handled = await handleWahaWebhookApi({
    req,
    res,
    sendJson,
    processMessageFn: async input => {
      calls.process.push(input);
      return {
        reply: 'Hola, ¿en qué producto te ayudo?',
        provider: 'elankav',
        status: 'completed'
      };
    },
    delivery: {
      async sendText(input) {
        calls.delivery.push(input);
        return { chatId: input.chatId, messageId: 'reply-001' };
      }
    },
    env: {}
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.processed, true);
  assert.equal(res.payload.replied, true);
  assert.equal(calls.process.length, 1);
  assert.equal(calls.process[0].channel, 'whatsapp');
  assert.equal(calls.process[0].phone, '50578828089');
  assert.deepEqual(calls.delivery, [{
    chatId: '50578828089@c.us',
    text: 'Hola, ¿en qué producto te ayudo?'
  }]);
});

test('ignora mensajes enviados por la propia sesión', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      payload: {
        id: { id: 'msg-003' },
        from: '50578828089@c.us',
        fromMe: true,
        body: 'Respuesta saliente'
      }
    }
  });
  const res = createResponse();
  let processed = false;

  await handleWahaWebhookApi({
    req,
    res,
    sendJson,
    processMessageFn: async () => {
      processed = true;
    },
    delivery: { sendText: async () => {} },
    env: {}
  });

  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.ignored, true);
  assert.equal(processed, false);
});

test('exige token cuando WAHA_WEBHOOK_TOKEN está configurado', async () => {
  const req = createRequest({
    headers: { 'content-type': 'application/json', host: 'localhost' },
    body: {
      event: 'message',
      payload: { from: '50578828089@c.us', body: 'Hola' }
    }
  });
  const res = createResponse();

  await handleWahaWebhookApi({
    req,
    res,
    sendJson,
    processMessageFn: async () => ({ reply: 'no debe ejecutarse' }),
    delivery: { sendText: async () => {} },
    env: { WAHA_WEBHOOK_TOKEN: 'secreto' }
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.success, false);
});

test('expone readiness por GET sin procesar mensajes', async () => {
  const req = createRequest({ method: 'GET', body: {} });
  const res = createResponse();

  await handleWahaWebhookApi({
    req,
    res,
    sendJson,
    delivery: { sendText: async () => {} },
    env: {}
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'READY');
});
