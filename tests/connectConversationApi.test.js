const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { handleConnectConversationApi } = require('../api/connectConversationApi');

function createRequest({ body, token = 'token' } = {}) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/api/waha/send-text';
  req.headers = { host: 'localhost', authorization: `Bearer ${token}` };
  req.destroy = () => {};
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body || {})));
    req.emit('end');
  });
  return req;
}

function createResponse() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
}

test('envia texto WAHA solicitado por CONNECT', async () => {
  const previous = process.env.ORCHESTRATOR_INTERNAL_TOKEN;
  process.env.ORCHESTRATOR_INTERNAL_TOKEN = 'token';
  const calls = [];
  const responses = [];

  await handleConnectConversationApi({
    req: createRequest({ body: { chatId: '50578828089@c.us', text: 'Hola' } }),
    res: createResponse(),
    sendJson(_res, status, payload) { responses.push({ status, payload }); },
    dependencies: {
      delivery: {
        async sendText(input) {
          calls.push(input);
          return { chatId: input.chatId, messageId: 'wa-out-1' };
        }
      }
    }
  });

  process.env.ORCHESTRATOR_INTERNAL_TOKEN = previous;
  assert.equal(calls[0].text, 'Hola');
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].payload.messageId, 'wa-out-1');
});

