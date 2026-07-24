'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { handleConnectToolApi } = require('../api/connectToolApi');

function request({ token = 'secret', body = '{}' } = {}) {
  const req = new EventEmitter();
  req.url = '/api/tools/connect';
  req.method = 'POST';
  req.headers = { host: 'localhost', 'x-elan-ai-token': token };
  process.nextTick(() => {
    req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return req;
}

function responseCapture() {
  return {
    statusCode: null,
    payload: null,
    res: { setHeader() {} },
    sendJson(_res, statusCode, payload) {
      this.statusCode = statusCode;
      this.payload = payload;
    }
  };
}

test('API autentica ELAN IA y delega al gateway', async () => {
  const previous = process.env.ELAN_AI_INTERNAL_TOKEN;
  process.env.ELAN_AI_INTERNAL_TOKEN = 'secret';
  const capture = responseCapture();
  const calls = [];

  try {
    const handled = await handleConnectToolApi({
      req: request({ body: JSON.stringify({ operation: 'leads.list' }) }),
      res: capture.res,
      sendJson: capture.sendJson.bind(capture),
      service: {
        async execute(input) {
          calls.push(input);
          return { operation: input.operation };
        }
      }
    });

    assert.equal(handled, true);
    assert.equal(capture.statusCode, 200);
    assert.equal(capture.payload.success, true);
    assert.equal(calls[0].operation, 'leads.list');
  } finally {
    if (previous === undefined) delete process.env.ELAN_AI_INTERNAL_TOKEN;
    else process.env.ELAN_AI_INTERNAL_TOKEN = previous;
  }
});

test('API rechaza credencial incorrecta', async () => {
  const previous = process.env.ELAN_AI_INTERNAL_TOKEN;
  process.env.ELAN_AI_INTERNAL_TOKEN = 'secret';
  const capture = responseCapture();

  try {
    await handleConnectToolApi({
      req: request({ token: 'incorrecta' }),
      res: capture.res,
      sendJson: capture.sendJson.bind(capture)
    });
    assert.equal(capture.statusCode, 401);
    assert.equal(capture.payload.error.code, 'UNAUTHORIZED');
  } finally {
    if (previous === undefined) delete process.env.ELAN_AI_INTERNAL_TOKEN;
    else process.env.ELAN_AI_INTERNAL_TOKEN = previous;
  }
});
