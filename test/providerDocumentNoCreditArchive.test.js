'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('document is archived for recruitment when commercial AI has no credit', async () => {
  const previous = { base: process.env.WAHA_BASE_URL, key: process.env.WAHA_API_KEY, token: process.env.CONNECT_PROVIDER_INTELLIGENCE_TOKEN, connect: process.env.ELANKAV_CONNECT_URL };
  process.env.WAHA_BASE_URL = 'https://waha.elankav.com';
  process.env.WAHA_API_KEY = 'waha-key';
  process.env.CONNECT_PROVIDER_INTELLIGENCE_TOKEN = 'connect-key';
  process.env.ELANKAV_CONNECT_URL = 'http://connect.test';
  delete require.cache[require.resolve('../services/providerInboundIntelligenceService')];
  const { ingestProviderDocument } = require('../services/providerInboundIntelligenceService');
  const calls = [];
  const result = await ingestProviderDocument({
    providerId: 'provider-1', mediaUrl: 'https://waha.elankav.com/file.pdf',
    fileName: 'Cotizacion proveedor.pdf', mimeType: 'application/pdf',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, headers: init.headers || {} });
      if (url.includes('/intelligence/documents')) return new Response(JSON.stringify({ error: { code: 'PROVIDER_COMMERCIAL_AI_FAILED', message: 'sin crédito' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      if (url.includes('/recruitment/documents')) return new Response(JSON.stringify({ status: 'RECIBIDO' }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(Buffer.from('pdf'), { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
  });
  assert.equal(result.commercialAnalysisPending, true);
  assert.equal(result.recruitment.status, 'RECIBIDO');
  assert.equal(calls.find(x => x.url.includes('/recruitment/documents')).headers['X-Document-Type'], 'quotation');
  for (const [name, value] of Object.entries({ WAHA_BASE_URL: previous.base, WAHA_API_KEY: previous.key, CONNECT_PROVIDER_INTELLIGENCE_TOKEN: previous.token, ELANKAV_CONNECT_URL: previous.connect })) value === undefined ? delete process.env[name] : process.env[name] = value;
});
