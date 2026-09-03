'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDesignReadyCaption,
  createWahaDeliveryAdapter,
  assertVoiceDeliveryInput,
  assertImageBytes,
  assertImageDeliveryInput
} = require('../adapters/wahaDeliveryAdapter');

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get() { return null; } },
    async json() {
      return payload;
    }
  };
}

function binaryResponse(bytes, { ok = true, status = 200, contentType = 'image/jpeg' } = {}) {
  const buffer = Buffer.from(bytes);
  return {
    ok,
    status,
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase();
        if (key === 'content-length') return String(buffer.length);
        if (key === 'content-type') return contentType;
        return null;
      }
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
    async json() {
      return null;
    }
  };
}

test('DESIGN-DELIVERY-CLOSE-02 sendImage descarga bytes y usa BASE64 en WAHA', async () => {
  const calls = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x02, 0x03]);
  const adapter = createWahaDeliveryAdapter({
    env: {
      WAHA_BASE_URL: 'https://waha.test',
      WAHA_API_KEY: 'api-key',
      WAHA_SESSION: 'ELANKAV'
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      if (options.method === 'GET') return binaryResponse(jpeg);
      return jsonResponse({ id: { id: 'image-message-1' } });
    }
  });

  const result = await adapter.sendImage({
    phone: '88888888',
    imageUrl: 'https://storage.test/render.jpg?token=redacted',
    caption: buildDesignReadyCaption({ request_code: 'DESIGN-TEST' }),
    fileName: 'render.jpg',
    mimeType: 'image/jpeg'
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://storage.test/render.jpg?token=redacted');
  assert.equal(calls[0].options.method, 'GET');

  const body = JSON.parse(calls[1].options.body);
  assert.equal(calls[1].url, 'https://waha.test/api/sendImage');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['X-Api-Key'], 'api-key');
  assert.equal(body.session, 'ELANKAV');
  assert.equal(body.chatId, '50588888888@c.us');
  assert.equal(body.file.url, undefined);
  assert.equal(body.file.data, jpeg.toString('base64'));
  assert.equal(body.file.filename, 'render.jpg');
  assert.equal(body.file.mimetype, 'image/jpeg');
  assert.equal(result.chatId, '50588888888@c.us');
  assert.equal(result.messageId, 'image-message-1');
});

test('ELAN Copiloto envía captura BASE64 directamente a WhatsApp sin URL pública', async () => {
  const calls = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x02, 0x03]);
  const adapter = createWahaDeliveryAdapter({
    env: {
      WAHA_BASE_URL: 'https://waha.test',
      WAHA_API_KEY: 'api-key',
      WAHA_SESSION: 'ELANKAV'
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return jsonResponse({ id: { id: 'field-image-1' } });
    }
  });

  const result = await adapter.sendImageData({
    phone: '88888888',
    data: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    caption: '📸 ELAN Copiloto · Captura de campo',
    fileName: 'captura.jpg',
    mimeType: 'image/jpeg'
  });

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://waha.test/api/sendImage');
  assert.equal(body.chatId, '50588888888@c.us');
  assert.equal(body.file.data, jpeg.toString('base64'));
  assert.equal(body.file.filename, 'captura.jpg');
  assert.equal(result.messageId, 'field-image-1');
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

test('sendImage rechaza contenido que no coincide con el MIME antes de llamar WAHA', async () => {
  const calls = [];
  const adapter = createWahaDeliveryAdapter({
    env: {
      WAHA_BASE_URL: 'https://waha.test',
      WAHA_SESSION: 'ELANKAV'
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return binaryResponse(Buffer.from('<html>not-an-image</html>'));
    }
  });

  await assert.rejects(
    adapter.sendImage({
      phone: '88888888',
      imageUrl: 'https://storage.test/broken.jpg',
      fileName: 'broken.jpg',
      mimeType: 'image/jpeg'
    }),
    /WAHA_IMAGE_CONTENT_INVALID/
  );
  assert.equal(calls.length, 1);
});

test('assertImageBytes valida firmas JPEG, PNG y WEBP', () => {
  assert.doesNotThrow(() => assertImageBytes(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'));
  assert.doesNotThrow(() => assertImageBytes(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), 'image/png'));
  assert.doesNotThrow(() => assertImageBytes(Buffer.from('RIFF0000WEBP', 'ascii'), 'image/webp'));
  assert.throws(() => assertImageBytes(Buffer.from('not-jpeg'), 'image/jpeg'), /WAHA_IMAGE_CONTENT_INVALID/);
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
