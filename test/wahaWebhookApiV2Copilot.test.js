'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { handleWahaWebhookApiV2 } = require('../api/wahaWebhookApiV2');

function request(body) {
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

test('V2 permite al Owner activar Copiloto por texto sin habilitar respuestas de clientes', async () => {
  const output = recorder();
  const sent = [];
  let liveCalls = 0;

  await handleWahaWebhookApiV2({
    req: request({
      event: 'message',
      id: 'owner-copilot-text-01',
      session: 'ELANKAV',
      payload: {
        from: '50588388940@c.us',
        body: 'ELAN, activa modo copiloto',
        type: 'chat',
        fromMe: false
      }
    }),
    res: response(),
    sendJson: output.sendJson,
    dependencies: {
      async createConnectLiveSession(input) {
        liveCalls += 1;
        assert.equal(input.phone, '50588388940');
        assert.equal(input.platform, 'ELANVISUAL');
        return {
          url: 'https://copilot.elankav.com/elan-live/ONE-TIME',
          identity: { role: 'owner' }
        };
      },
      async sendWahaText(input) {
        sent.push(input);
        return { id: 'sent-owner-live-01' };
      }
    }
  });

  assert.equal(liveCalls, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /ELAN Copiloto listo/);
  assert.equal(output.calls[0].payload.elanLive, true);
  assert.equal(output.calls[0].payload.ownerMode, true);
  assert.equal(output.calls[0].payload.pipeline, 'owner-copilot-live');
});

test('V2 permite activar Copiloto por nota de voz del Owner', async () => {
  const output = recorder();
  const sent = [];
  let downloadCalls = 0;
  let transcribeCalls = 0;
  let liveCalls = 0;

  await handleWahaWebhookApiV2({
    req: request({
      event: 'message',
      id: 'owner-copilot-voice-01',
      session: 'ELANKAV',
      payload: {
        from: '50588388940@c.us',
        type: 'ptt',
        fromMe: false,
        media: {
          url: 'https://waha.example/voice.ogg',
          mimetype: 'audio/ogg; codecs=opus',
          filename: 'voice.ogg'
        }
      }
    }),
    res: response(),
    sendJson: output.sendJson,
    dependencies: {
      async downloadWahaMedia({ url }) {
        downloadCalls += 1;
        assert.equal(url, 'https://waha.example/voice.ogg');
        return { buffer: Buffer.from('audio'), mimeType: 'audio/ogg' };
      },
      async transcribeAudio() {
        transcribeCalls += 1;
        return 'ELAN, actívate modo copiloto';
      },
      async createConnectLiveSession() {
        liveCalls += 1;
        return {
          url: 'https://copilot.elankav.com/elan-live/VOICE-ONE-TIME',
          identity: { role: 'owner' }
        };
      },
      async sendWahaText(input) {
        sent.push(input);
        return { id: 'sent-owner-live-voice-01' };
      }
    }
  });

  assert.equal(downloadCalls, 1);
  assert.equal(transcribeCalls, 1);
  assert.equal(liveCalls, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /VOICE-ONE-TIME/);
  assert.equal(output.calls[0].payload.elanLive, true);
  assert.equal(output.calls[0].payload.replyType, 'text');
});

test('V2 mantiene clientes en fail-closed aunque digan activa modo copiloto', async () => {
  const output = recorder();
  let liveCalls = 0;
  let sentCalls = 0;

  await handleWahaWebhookApiV2({
    req: request({
      event: 'message',
      id: 'customer-copilot-denied-by-mode-01',
      session: 'ELANKAV',
      payload: {
        from: '50577777777@c.us',
        body: 'activa modo copiloto',
        type: 'chat',
        fromMe: false
      }
    }),
    res: response(),
    sendJson: output.sendJson,
    dependencies: {
      async createConnectLiveSession() {
        liveCalls += 1;
        throw new Error('SHOULD_NOT_RUN');
      },
      async sendWahaText() {
        sentCalls += 1;
      }
    }
  });

  assert.equal(liveCalls, 0);
  assert.equal(sentCalls, 0);
  assert.equal(output.calls[0].payload.replySent, false);
  assert.equal(output.calls[0].payload.automationDisabled, true);
  assert.equal(output.calls[0].payload.pipeline, 'customer-auto-reply-disabled');
});
