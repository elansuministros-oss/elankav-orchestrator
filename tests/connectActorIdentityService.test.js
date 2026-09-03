'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchConnectActorIdentity,
  validateActorIdentityPayload
} = require('../services/connectActorIdentityService');

test('consulta CONNECT actor identity con teléfono, identidad y plataforma antes de responder WhatsApp', async () => {
  const previous = process.env.CONNECT_INTERNAL_API_TOKEN;
  process.env.CONNECT_INTERNAL_API_TOKEN = 'actor-test-token';
  let requestedUrl = '';
  let headers = null;

  try {
    const result = await fetchConnectActorIdentity({
      identity: '123456789@lid',
      externalUserId: '123456789@lid',
      phone: '50577776666',
      chatId: '123456789@lid',
      platform: 'ELANVISUAL',
      fetchFn: async (url, options) => {
        requestedUrl = String(url);
        headers = options.headers;
        return new Response(JSON.stringify({
          data: {
            resolutionStatus: 'resolved',
            role: 'prospect',
            commercialRole: 'supplier_prospect',
            relationshipAuthority: 'prospecting_outreach',
            registered: true,
            canonicalPhone: '50577776666',
            displayName: 'Proveedor de prueba'
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    assert.match(requestedUrl, /\/api\/v1\/actor-identity\/resolve\?/);
    assert.match(requestedUrl, /identity=123456789%40lid/);
    assert.match(requestedUrl, /phone=50577776666/);
    assert.match(requestedUrl, /platform=ELANVISUAL/);
    assert.equal(headers.Authorization, 'Bearer actor-test-token');
    assert.equal(result.role, 'prospect');
    assert.equal(result.commercialRole, 'supplier_prospect');
    assert.equal(result.relationshipAuthority, 'prospecting_outreach');
  } finally {
    if (previous === undefined) delete process.env.CONNECT_INTERNAL_API_TOKEN;
    else process.env.CONNECT_INTERNAL_API_TOKEN = previous;
  }
});

test('rechaza commercialRole inválido para un prospecto', () => {
  assert.throws(
    () => validateActorIdentityPayload({
      data: {
        role: 'prospect',
        commercialRole: 'guessed_supplier'
      }
    }),
    /CONNECT_ACTOR_IDENTITY_COMMERCIAL_ROLE_INVALID/
  );
});
