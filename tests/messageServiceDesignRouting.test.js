'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  handleDesignIntent
} = require('../services/messageService');

test('messageService enruta solicitud de diseño al Design Engine', async () => {
  const result = await handleDesignIntent({
    message: 'Diseñame un rótulo para mi negocio',
    context: {
      requestId: 'MSG-DESIGN-001',
      platform: 'ELANVISUAL',
      channel: 'whatsapp',
      externalUserId: '+50578828089',
      phone: '+50578828089'
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.designAction, true);
  assert.equal(result.model, 'elankav-design-engine-stub');
  assert.equal(result.design.result.status, 'STUB_ACCEPTED');
  assert.equal(
    result.design.request.actor.source,
    'ELAN_IA'
  );
});

test('messageService no desvía mensajes sin intención de diseño', async () => {
  const result = await handleDesignIntent({
    message: 'Necesito información sobre mis pedidos',
    context: {
      platform: 'ELANVISUAL'
    }
  });

  assert.equal(result.handled, false);
  assert.equal(result.detection.detected, false);
});

test('solicitud de diseño sin plataforma continúa al fallback', async () => {
  const result = await handleDesignIntent({
    message: 'Quiero un render de mi negocio',
    context: {}
  });

  assert.equal(result.handled, false);
  assert.equal(result.detection.detected, true);
  assert.equal(result.reason, 'DESIGN_PLATFORM_REQUIRED');
});

test('resultado de diseño nunca conversa directamente con cliente', async () => {
  const result = await handleDesignIntent({
    message: 'Necesito una propuesta visual para la fachada',
    context: {
      platform: 'ELANVISUAL',
      externalUserId: '+50578828089'
    }
  });

  assert.equal(
    result.design.result.conversational,
    false
  );
  assert.equal(
    result.design.request.directClientConversation,
    false
  );
});
