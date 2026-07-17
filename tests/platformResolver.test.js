'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findPlatform,
  resolvePlatform
} = require('../services/context/platformResolver');
const {
  buildContext,
  CONTEXT_VERSION
} = require('../services/context/contextBuilder');

test('resuelve plataforma explícita y la normaliza al identificador canónico', () => {
  const result = resolvePlatform({ platform: 'ELAN VISUAL' });

  assert.equal(result.platform, 'elanvisual');
  assert.equal(result.source, 'explicit');
  assert.equal(result.confidence, 1);
});

test('prioriza plataforma explícita sobre menciones diferentes en el mensaje', () => {
  const result = resolvePlatform({
    platform: 'ELANPET',
    message: 'Revisá el administrador de ELANVISUAL'
  });

  assert.equal(result.platform, 'elanpet');
  assert.equal(result.source, 'explicit');
});

test('resuelve plataforma desde metadata cuando no existe plataforma explícita', () => {
  const result = resolvePlatform({
    metadata: { sourcePlatform: 'elan home' }
  });

  assert.equal(result.platform, 'elanhome');
  assert.equal(result.source, 'metadata');
});

test('infiere ELANCENTER desde el mensaje sin alterar Owner Mode', () => {
  const context = buildContext({
    message: 'Necesito revisar ELAN CENTER',
    phone: '88388940',
    channel: 'WhatsApp'
  });

  assert.equal(CONTEXT_VERSION, 'ORCH-038');
  assert.equal(context.platform, 'elancenter');
  assert.equal(context.metadata.platformResolution.source, 'message');
  assert.equal(context.owner.isOwner, true);
  assert.equal(context.channel, 'whatsapp');
});

test('mantiene plataforma sin resolver cuando no hay evidencia suficiente', () => {
  const result = resolvePlatform({
    message: 'Necesito revisar una cotización pendiente'
  });

  assert.equal(result.platform, null);
  assert.equal(result.source, 'unresolved');
  assert.equal(result.confidence, 0);
});

test('no confunde palabras parciales con alias de plataforma', () => {
  assert.equal(findPlatform('Necesito centrar el diseño'), null);
  assert.equal(findPlatform('La mascota está en casa'), null);
});
