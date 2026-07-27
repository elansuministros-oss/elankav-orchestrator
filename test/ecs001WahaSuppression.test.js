'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { handleWahaWebhookApi } = require('../api/wahaWebhookApi');

function createRequest(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/webhook/inbound';
  req.headers = { host: 'localhost' };
  req.destroy = () => {};
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function createResponse() {
  return { setHeader() {} };
}

test('WAHA acknowledges suppressed reply without sending text or voice', async () => {
  const responses = [];
  let textCalls = 0;
  let voiceCalls = 0;
  let synthesisCalls = 0;

  await handleWahaWebhookApi({
    req: createRequest({
      event: 'message',
      session: 'ELANKAV',
      payload: {
        from: '50577777777@c.us',
        body: 'Ya envié los datos',
        fromMe: false
      }
    }),
    res: createResponse(),
    sendJson(res, status, payload) {
      responses.push({ status, payload });
    },
    dependencies: {
      async processMessage() {
        return {
          reply: '',
          shouldReply: false,
          suppressionReason: 'CONVERSATION_OWNED_BY_HUMAN',
          model: 'elankav-commercial-ownership',
          context: { ownerMode: false, platform: 'ELANVISUAL' }
        };
      },
      async sendWahaText() { textCalls += 1; },
      async sendWahaVoice() { voiceCalls += 1; },
      async synthesizeSpeech() { synthesisCalls += 1; }
    }
  });

  assert.equal(textCalls, 0);
  assert.equal(voiceCalls, 0);
  assert.equal(synthesisCalls, 0);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].payload.processed, true);
  assert.equal(responses[0].payload.replySent, false);
  assert.equal(responses[0].payload.replyType, 'suppressed');
  assert.equal(
    responses[0].payload.suppressionReason,
    'CONVERSATION_OWNED_BY_HUMAN'
  );
});