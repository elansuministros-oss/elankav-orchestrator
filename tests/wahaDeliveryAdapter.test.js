'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDesignReadyCaption,
  createWahaDeliveryAdapter,
  assertVoiceDeliveryInput,
  assertImageDeliveryInput
} = require('../adapters/wahaDeliveryAdapter');

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}

test('DESIGN-DELIVERY-CLOSE-02 sendImage usa el endpoint WAHA oficial', async () => {
  const calls = [];
  const adapter = createWahaDeliveryAdapter({
    env: {
      WAHA_BASE_URL: 'https://waha.test',
      WAHA_API_KEY: 'api-key',
      WAHA_SESSION: 'ELANKAV'
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return jsonResponse({ id: { id: 'image-message-1' } });
    }
  });

  const result = await adapter.sendImage({
    phone: '88888888',
    imageUrl: 'https://storage.test/render.png?token=redacted',
    caption: buildDesignReadyCaption({ request_code: 'DESIGN-TEST' }),
    fileName: 'render.png',
    mimeType: 'image/png'
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://waha.test/api/sendImage');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-Api-Key'], 'api-key');
  assert.equal(body.session, 'ELANKAV');
  assert.equal(body.chatId, '50588888888@c.us');
  assert.equal(body.file.url, 'https://storage.test/render.png?token=redacted');
  assert.equal(body.file.filename, 'render.png');
  assert.equal(body.file.mimetype, 'image/png');
  assert.equal(result.chatId, '50588888888@c.us');
  assert.equal(result.messageId, 'image-message-1');
});

test('DESIGN-DELIVERY-CLOSE-02 sendImage exige URL y MIME de imagen', () => {
  assert.throws(
    () => assertImageDeliveryInput({ imageUrl: '', mimeType: 'image/png' }),
    /WAHA_IMAGE_URL_REQUIRED/
  );
  assert.throws(
    () => assertImageDeliveryInput({ imageUrl: 'https://storage.test/file.pdf', mimeType: 'application/pdf' }),
    /WAHA_IMAGE_MIME_UNSUPPORTED/
  );
});

test('sendVoice preserva chatId @lid y usa endpoint WAHA oficial', async () => {
  const calls = [];
  const adapter = createWahaDeliveryAdapter({
    env: {
      WAHA_BASE_URL: 'https://waha.test',
      WAHA_API_KEY: 'api-key',
      WAHA_SESSION: 'ELANKAV'
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return jsonResponse({ id: { id: 'voice-message-1' } });
    }
  });

  const result = await adapter.sendVoice({
    chatId: '168534952960065@lid',
    data: 'b3B1cw==',
    mimeType: 'audio/ogg; codecs=opus'
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://waha.test/api/sendVoice');
  assert.equal(body.chatId, '168534952960065@lid');
  assert.equal(body.file.mimetype, 'audio/ogg');
  assert.equal(body.file.data, 'b3B1cw==');
  assert.equal(result.chatId, '168534952960065@lid');
  assert.equal(result.messageId, 'voice-message-1');
});

test('sendVoice valida audio compatible', () => {
  assert.doesNotThrow(() => assertVoiceDeliveryInput({
    data: 'b3B1cw==',
    mimeType: 'audio/ogg; codecs=opus'
  }));
  assert.throws(
    () => assertVoiceDeliveryInput({ data: '', mimeType: 'audio/ogg' }),
    /WAHA_VOICE_DATA_REQUIRED/
  );
  assert.throws(
    () => assertVoiceDeliveryInput({ data: 'b3B1cw==', mimeType: 'text/plain' }),
    /WAHA_VOICE_MIME_UNSUPPORTED/
  );
});
