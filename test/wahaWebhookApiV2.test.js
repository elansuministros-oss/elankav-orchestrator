'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  clearWahaWebhookV2Dedupe,
  handleWahaWebhookApiV2
} = require('../api/wahaWebhookApiV2');

function request(body, method = 'POST') {
  const req = new EventEmitter();
  req.method = method;
  req.url = '/webhook/inbound';
  req.headers = { host: 'localhost' };
  req.destroy = () => {};
  process.nextTick(() => {
    if (body !== null) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function response() {
  return { setHeader() {} };
}

function recorder() {
  const calls = [];
  return {
    calls,
    sendJson(res, status, payload) {
      calls.push({ status, payload });
    }
  };
}

test.beforeEach(() => clearWahaWebhookV2Dedupe());

test('GET anuncia VOICE-PIPELINE-V2', async () => {
  const output = recorder();
  const handled = await handleWahaWebhookApiV2({
    req: request(null, 'GET'),
    res: response(),
    sendJson: output.sendJson
  });
  assert.equal(handled, true);
  assert.equal(output.calls[0].payload.status, 'READY');
  assert.equal(output.calls[0].payload.version, 'VOICE-PIPELINE-V2');
});

test('enruta audio GOWS a Voice Pipeline V2', async () => {
  const output = recorder();
  const received = [];
  await handleWahaWebhookApiV2({
    req: request({
      event: 'message',
      session: 'ELANKAV',
      payload: {
        id: 'false_50588888888@lid_MSG123',
        from: '50588888888@lid',
        fromMe: false,
        media: {
          url: '/voice.ogg',
          mimetype: 'audio/ogg; codecs=opus'
        }
      }
    }),
    res: response(),
    sendJson: output.sendJson,
    dependencies: {
      async runVoicePipelineV2(event) {
        received.push(event);
        return { processed: true, replySent: true, replyType: 'voice' };
      }
    }
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].media.mimeType, 'audio/ogg');
  assert.equal(output.calls[0].payload.pipeline, 'voice-v2');
  assert.equal(output.calls[0].payload.replyType, 'voice');
});

test('audio duplicado devuelve HTTP 200 sin segundo proceso', async () => {
  const output = recorder();
  await handleWahaWebhookApiV2({
    req: request({
      event: 'message',
      payload: {
        id: 'false_50588888888@lid_MSG123',
        from: '50588888888@lid',
        type: 'ptt'
      }
    }),
    res: response(),
    sendJson: output.sendJson,
    dependencies: {
      async runVoicePipelineV2() {
        return { duplicate: true, processed: false };
      }
    }
  });
  assert.equal(output.calls[0].status, 200);
  assert.equal(output.calls[0].payload.reason, 'DUPLICATE_MESSAGE');
});

test('mensajes de texto conservan processMessage y respuesta de texto', async () => {
  const output = recorder();
  const processed = [];
  const sent = [];
  await handleWahaWebhookApiV2({
    req: request({
      event: 'message',
      id: 'text-1',
      session: 'ELANKAV',
      payload: {
        from: '50588388940@c.us',
        body: 'estado del sistema',
        fromMe: false,
        type: 'chat'
      }
    }),
    res: response(),
    sendJson: output.sendJson,
    dependencies: {
      async processMessage(input) {
        processed.push(input);
        return { reply: 'Todo operativo.', context: { ownerMode: true, platform: 'ELANVISUAL' } };
      },
      async sendWahaText(input) {
        sent.push(input);
      }
    }
  });

  assert.equal(processed.length, 1);
  assert.equal(processed[0].message, 'estado del sistema');
  assert.equal(processed[0].metadata.pipeline, 'text-v1-preserved');
  assert.deepEqual(sent[0], {
    session: 'ELANKAV',
    chatId: '50588388940@c.us',
    text: 'Todo operativo.'
  });
  assert.equal(output.calls[0].payload.replyType, 'text');
});

test('texto duplicado no se procesa dos veces', async () => {
  const body = {
    event: 'message',
    id: 'text-duplicate',
    payload: { from: '50588888888@c.us', body: 'Hola', fromMe: false, type: 'chat' }
  };
  let processed = 0;
  const dependencies = {
    async processMessage() {
      processed += 1;
      return { reply: 'Respuesta', context: {} };
    },
    async sendWahaText() {}
  };

  const first = recorder();
  await handleWahaWebhookApiV2({ req: request(body), res: response(), sendJson: first.sendJson, dependencies });
  const second = recorder();
  await handleWahaWebhookApiV2({ req: request(body), res: response(), sendJson: second.sendJson, dependencies });

  assert.equal(processed, 1);
  assert.equal(second.calls[0].payload.reason, 'DUPLICATE_MESSAGE');
});

test('ignora mensajes propios, grupos y eventos no-message', async () => {
  const cases = [
    [{ event: 'message', payload: { from: '50588888888@c.us', body: 'x', fromMe: true } }, 'FROM_ME'],
    [{ event: 'message', payload: { from: '120363@g.us', body: 'x', fromMe: false } }, 'GROUP_MESSAGE'],
    [{ event: 'session.status', payload: { status: 'WORKING' } }, 'EVENT_NOT_MESSAGE']
  ];

  for (const [body, reason] of cases) {
    const output = recorder();
    await handleWahaWebhookApiV2({ req: request(body), res: response(), sendJson: output.sendJson });
    assert.equal(output.calls[0].payload.reason, reason);
  }
});
