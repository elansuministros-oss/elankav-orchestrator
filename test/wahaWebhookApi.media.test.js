'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractIncoming,
  extractMediaReference
} = require('../api/wahaWebhookApi');

test('extractMediaReference normaliza una imagen descargable de WAHA', () => {
  const media = extractMediaReference({
    hasMedia: true,
    media: {
      url: 'https://waha.elankav.com/api/files/message.jpg',
      mimetype: 'image/jpeg',
      filename: 'lista-precios.jpg',
      error: null
    }
  });

  assert.deepEqual(media, {
    type: 'image',
    url: 'https://waha.elankav.com/api/files/message.jpg',
    mimetype: 'image/jpeg',
    filename: 'lista-precios.jpg',
    source: 'waha',
    available: true,
    error: null
  });
});

test('extractIncoming acepta una imagen sin texto', () => {
  const incoming = extractIncoming({
    event: 'message',
    session: 'ELANKAV',
    payload: {
      id: 'false_50588887777@c.us_ABC',
      from: '50588887777@c.us',
      fromMe: false,
      body: '',
      hasMedia: true,
      media: {
        url: 'https://waha.elankav.com/api/files/lista.jpg',
        mimetype: 'image/jpeg',
        filename: null,
        error: null
      }
    }
  });

  assert.equal(incoming.text, '');
  assert.equal(incoming.hasMedia, true);
  assert.equal(incoming.media.type, 'image');
  assert.equal(incoming.media.available, true);
  assert.equal(incoming.senderRaw, '50588887777@c.us');
  assert.equal(incoming.phone, '50588887777');
});

test('extractIncoming conserva mensajes de texto sin medios', () => {
  const incoming = extractIncoming({
    event: 'message',
    payload: {
      from: '88887777@c.us',
      fromMe: false,
      body: 'Hola'
    }
  });

  assert.equal(incoming.text, 'Hola');
  assert.equal(incoming.hasMedia, false);
  assert.equal(incoming.media, null);
  assert.equal(incoming.phone, '50588887777');
});
