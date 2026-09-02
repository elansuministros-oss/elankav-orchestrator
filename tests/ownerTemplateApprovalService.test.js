'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOwnerTemplateApproval,
  executeOwnerTemplateApproval
} = require('../services/ownerTemplateApprovalService');

test('detecta aprobación natural de la plantilla de proveedores', () => {
  const command = detectOwnerTemplateApproval('ELAN, apruebo la plantilla de proveedores');
  assert.equal(command?.type, 'business_owner_template_approval');
  assert.equal(command?.input?.action, 'approve');
  assert.equal(command?.input?.supplier, true);
});

test('detecta orden natural para mandar la prueba Owner', () => {
  const command = detectOwnerTemplateApproval('ELAN, mandame la prueba de la plantilla de proveedores');
  assert.equal(command?.type, 'business_owner_template_approval');
  assert.equal(command?.input?.action, 'preview');
  assert.equal(command?.input?.supplier, true);
});

test('manda prueba Owner sin aprobar la plantilla', async () => {
  const calls = [];
  const requestImpl = async (path, options) => {
    calls.push([path, options]);
    if (path.endsWith('/owner-template-reviews')) return [{
      approved: false,
      template: { id: '11111111-1111-4111-8111-111111111111', key: 'elanvisual-supplier-network-v1', name: 'Proveedores', version: 1 },
      evidence: [{ channel: 'email', status: 'pending' }, { channel: 'whatsapp', status: 'pending' }]
    }];
    return { approved: false };
  };
  const result = await executeOwnerTemplateApproval(
    detectOwnerTemplateApproval('ELAN, enviame la prueba de la plantilla de proveedores'),
    { requestImpl }
  );
  assert.equal(result.handled, true);
  assert.match(result.outputText, /Revisá tu correo y tu WhatsApp/);
  assert.equal(calls[1][0], '/console/api/prospecting/templates/11111111-1111-4111-8111-111111111111/owner-test');
  assert.equal(calls[1][1].method, 'POST');
});

test('solo aprueba la versión con ambas pruebas registradas', async () => {
  const calls = [];
  const requestImpl = async (path, options) => {
    calls.push([path, options]);
    if (path.endsWith('/owner-template-reviews')) return [{
      approved: false,
      template: { id: '11111111-1111-4111-8111-111111111111', key: 'elanvisual-supplier-network-v1', name: 'Proveedores', version: 1 },
      evidence: [{ channel: 'email', status: 'sent' }, { channel: 'whatsapp', status: 'sent' }]
    }];
    return { approved: true, template: { name: 'Proveedores', version: 1 } };
  };
  const result = await executeOwnerTemplateApproval(
    detectOwnerTemplateApproval('apruebo la plantilla elanvisual-supplier-network-v1'),
    { requestImpl }
  );
  assert.equal(result.handled, true);
  assert.match(result.outputText, /únicamente esta versión/);
  assert.equal(calls[1][0], '/api/v1/prospecting/templates/11111111-1111-4111-8111-111111111111/owner-approve');
});

test('detecta envío explícito a un contacto con correo y WhatsApp', () => {
  const command = detectOwnerTemplateApproval('ELAN, envía presentación a este contacto. Correo: persona@empresa.com. WhatsApp: +505 8888-8888');
  assert.equal(command?.input?.action, 'direct_send');
  assert.equal(command?.input?.email, 'persona@empresa.com');
  assert.equal(command?.input?.phone, '50588888888');
});

test('envía una plantilla aprobada por correo y WhatsApp sin activar campaña', async () => {
  const deliveries = [];
  const requestImpl = async path => {
    assert.equal(path, '/api/v1/prospecting/owner-template-reviews');
    return [{
      approved: true,
      template: { id: '11111111-1111-4111-8111-111111111111', key: 'elanvisual-corporate-intro-v3', name: 'Presentación corporativa', version: 1 },
      evidence: [{ channel: 'email', status: 'sent' }, { channel: 'whatsapp', status: 'sent' }]
    }];
  };
  let fetchCount = 0;
  const fetchImpl = async (url, options = {}) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      assert.match(String(url), /\/console\/api\/prospecting\/templates\/11111111/);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: '11111111-1111-4111-8111-111111111111',
            key: 'elanvisual-corporate-intro-v3',
            name: 'Presentación corporativa', version: 1,
            subjectTemplate: 'Presentación para {{company_name}}',
            htmlTemplate: '<html><img src="data:image/png;base64,aGVsbG8="/></html>',
            textTemplate: 'Hola {{contact_name}}. Conocé {{landing_url}}'
          };
        }
      };
    }
    assert.equal(options.method, 'POST');
    assert.match(String(url), /\/console\/api\/prospecting\/template-assets\?/);
    return { ok: true, status: 200, async json() { return { publicUrl: 'https://cdn.example.test/elan.png' }; } };
  };
  const delivery = {
    async deliver(input) {
      deliveries.push(input);
      return { status: 'SENT', externalRef: 'msg-' + deliveries.length };
    }
  };
  const result = await executeOwnerTemplateApproval(
    detectOwnerTemplateApproval('ELAN, envía presentación a este contacto. Correo persona@empresa.com WhatsApp 8888-8888'),
    {
      requestImpl,
      delivery,
      fetchImpl,
      env: { CONNECT_BASE_URL: 'https://connect.example.test', CONNECT_INTERNAL_API_TOKEN: 'test-token' }
    }
  );
  assert.equal(result.handled, true);
  assert.match(result.outputText, /no activó ninguna campaña/);
  assert.equal(deliveries.length, 3);
  assert.equal(deliveries[0].channel, 'email');
  assert.equal(deliveries[1].channel, 'whatsapp');
  assert.equal(deliveries[1].messageType, 'image');
  assert.equal(deliveries[2].channel, 'whatsapp');
  assert.equal(deliveries[2].messageType, undefined);
});

test('si la plantilla aprobada no tiene imagen WhatsApp no envía nada', async () => {
  let deliveryCalls = 0;
  const requestImpl = async () => [{
    approved: true,
    template: { id: '11111111-1111-4111-8111-111111111111', key: 'elanvisual-corporate-intro-v3', name: 'Presentación', version: 1 },
    evidence: [{ channel: 'email', status: 'sent' }, { channel: 'whatsapp', status: 'sent' }]
  }];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        id: '11111111-1111-4111-8111-111111111111',
        key: 'elanvisual-corporate-intro-v3', version: 1,
        subjectTemplate: 'Presentación', htmlTemplate: '<html>sin imagen</html>', textTemplate: 'Hola'
      };
    }
  });
  const delivery = { async deliver() { deliveryCalls += 1; return { status: 'SENT', externalRef: 'unexpected' }; } };
  await assert.rejects(
    executeOwnerTemplateApproval(
      detectOwnerTemplateApproval('ELAN, envía presentación a este contacto. Correo persona@empresa.com WhatsApp 8888-8888'),
      { requestImpl, delivery, fetchImpl, env: { CONNECT_BASE_URL: 'https://connect.example.test', CONNECT_INTERNAL_API_TOKEN: 'test-token' } }
    ),
    error => error?.code === 'OWNER_DIRECT_PRESENTATION_WHATSAPP_IMAGE_REQUIRED'
  );
  assert.equal(deliveryCalls, 0);
});
