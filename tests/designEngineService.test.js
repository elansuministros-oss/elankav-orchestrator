'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDesignRequest,
  processDesignRequest
} = require('../services/designEngineService');

test('construye DesignRequest con entrada exclusiva de ELAN IA', () => {
  const request = buildDesignRequest({
    requestId: 'REQ-001',
    identityId: 'IDENTITY-001',
    phone: '+50578828089',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    message: 'Quiero un diseño para un rótulo'
  });

  assert.equal(request.actor.source, 'ELAN_IA');
  assert.equal(request.platform, 'ELANVISUAL');
  assert.equal(request.directClientConversation, false);
});

test('rechaza solicitud de diseño sin plataforma', () => {
  assert.throws(
    () => buildDesignRequest({ message: 'Diseñame un rótulo' }),
    error => error.code === 'DESIGN_PLATFORM_REQUIRED'
  );
});

test('rechaza solicitud de diseño sin mensaje', () => {
  assert.throws(
    () => buildDesignRequest({ platform: 'ELANVISUAL' }),
    error => error.code === 'DESIGN_MESSAGE_REQUIRED'
  );
});

test('procesa solicitud mediante Adapter stub', async () => {
  const response = await processDesignRequest({
    requestId: 'REQ-002',
    identityId: 'IDENTITY-002',
    phone: '+50578828089',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    message: 'Necesito una propuesta de fachada'
  });

  assert.equal(response.handled, true);
  assert.equal(response.connected, false);
  assert.equal(response.result.status, 'STUB_ACCEPTED');
  assert.equal(response.result.conversational, false);
});
