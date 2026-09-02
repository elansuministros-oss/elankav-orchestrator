'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attributeProspectingResponse,
  createProspectingEmailReplyWorker,
  extractGmailBody,
  normalizePhone,
  parseAddressHeader
} = require('../services/prospectingResponseAttributionService');

test('normaliza teléfono y extrae correo de header From', () => {
  assert.equal(normalizePhone('8888-7777'), '50588887777');
  assert.equal(parseAddressHeader('Persona <ventas@empresa.com>'), 'ventas@empresa.com');
});

test('extrae cuerpo text/plain de Gmail', () => {
  const data = Buffer.from('Nos interesa una cotización.').toString('base64url');
  assert.equal(extractGmailBody({
    mimeType: 'multipart/alternative',
    parts: [{ mimeType: 'text/plain', body: { data } }]
  }), 'Nos interesa una cotización.');
});

test('envía respuesta atribuible a CONNECT con token interno', async () => {
  let request = null;
  const result = await attributeProspectingResponse({
    channel: 'email',
    destination: 'ventas@empresa.com',
    message: 'Nos interesa una cotización.',
    externalRef: 'msg-1',
    env: { CONNECT_BASE_URL: 'https://connect.test', CONNECT_INTERNAL_API_TOKEN: 'secret' },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        async json() {
          return { matched: true, prospectId: 'p1', classification: 'quote_request', ownerRecommended: true };
        }
      };
    }
  });

  assert.equal(result.matched, true);
  assert.equal(request.url, 'https://connect.test/api/v1/prospecting/responses/attribute');
  assert.equal(request.init.headers.Authorization, 'Bearer secret');
});

test('worker Gmail atribuye respuestas de inbox', async () => {
  const calls = [];
  const channelDelivery = {
    async listEmailMessages() { return [{ id: 'gmail-1' }]; },
    async getEmailMessage() {
      return {
        id: 'gmail-1',
        threadId: 'thread-1',
        internalDate: String(Date.now()),
        snippet: 'Quiero cotización',
        payload: {
          headers: [
            { name: 'From', value: 'Ana <ana@empresa.com>' },
            { name: 'Subject', value: 'Re: propuesta' },
            { name: 'Message-ID', value: '<reply-1@empresa.com>' }
          ],
          mimeType: 'text/plain',
          body: { data: Buffer.from('Quiero cotización').toString('base64url') }
        }
      };
    }
  };

  const worker = createProspectingEmailReplyWorker({
    channelDelivery,
    attributeImpl: async input => {
      calls.push(input);
      return { matched: true, ownerRecommended: true };
    },
    env: {}
  });

  const result = await worker.runOnce();
  assert.equal(result.processed, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.ownerRecommended, 1);
  assert.equal(calls[0].destination, 'ana@empresa.com');
});
