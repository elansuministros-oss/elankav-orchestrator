'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  commandKind,
  extractProviderQuery,
  initialMessage,
  rememberPendingMedia,
  consumePendingMedia,
  clearPendingOwnerMedia
} = require('../services/ownerProviderRecruitmentMessagePatch');

test('detecta comandos Owner de reclutamiento sin confundir consultas generales', () => {
  assert.equal(commandKind('ELAN registra este proveedor', { media: { url: 'https://waha.test/file' } }), 'register');
  assert.equal(commandKind('ELAN investiga este proveedor', { media: { url: 'https://waha.test/file' } }), 'investigate');
  assert.equal(commandKind('ELAN contacta este proveedor 8888 9999'), 'contact');
  assert.equal(commandKind('ELAN solicita tarifario a este proveedor'), 'request_price_list');
  assert.equal(commandKind('ELAN estado proveedor Vargas Centro'), 'status');
  assert.equal(commandKind('ELAN proveedores pendientes'), 'pending');
  assert.equal(commandKind('ELAN proveedores sin tarifario'), 'missing_price_list');
  assert.equal(commandKind('ELAN muéstrame lo que respondió este proveedor'), 'show_response');
  assert.equal(commandKind('ELAN agrega este catálogo al proveedor', { media: { url: 'https://waha.test/catalog.pdf' } }), 'add_catalog');
  assert.equal(commandKind('mostrame clientes pendientes'), null);
});

test('mensaje externo identifica inequívocamente a ELAN como IA', () => {
  const opening = initialMessage('contact', '¿Qué productos ofrecen?');
  assert.match(opening, /soy ELAN/i);
  assert.match(opening, /inteligencia artificial/i);
  assert.match(opening, /¿Qué productos ofrecen\?/);
});

test('extrae referencia humana del proveedor sin conservar ruido del comando', () => {
  assert.equal(extractProviderQuery('ELAN estado proveedor Vargas Centro'), 'Vargas Centro');
  assert.equal(extractProviderQuery('ELAN solicita tarifario a proveedor LED Solutions'), 'LED Solutions');
});


test('asocia el siguiente archivo del Owner con el comando previo de proveedor', () => {
  clearPendingOwnerMedia();
  const base = { phone: '50588388940', externalUserId: '50588388940@c.us', metadata: {} };
  rememberPendingMedia({ ...base, message: 'ELAN registra este proveedor' }, 'register');
  assert.equal(consumePendingMedia({ ...base, metadata: {} }), null);
  const pending = consumePendingMedia({
    ...base,
    message: '[Archivo recibido: proveedor.jpg]',
    metadata: { media: { url: 'https://waha.test/proveedor.jpg' }, messageType: 'image' }
  });
  assert.equal(pending.kind, 'register');
  assert.equal(pending.originalMessage, 'ELAN registra este proveedor');
  assert.equal(consumePendingMedia({
    ...base,
    metadata: { media: { url: 'https://waha.test/otro.jpg' } }
  }), null);
});
