'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('public WAHA file URL receives API key when runtime base is internal', async () => {
  const previous = {
    base: process.env.WAHA_BASE_URL,
    internal: process.env.WAHA_INTERNAL_BASE_URL,
    public: process.env.WAHA_PUBLIC_BASE_URL,
    key: process.env.WAHA_API_KEY
  };
  process.env.WAHA_BASE_URL = 'http://127.0.0.1:3000';
  process.env.WAHA_INTERNAL_BASE_URL = 'http://127.0.0.1:3000';
  delete process.env.WAHA_PUBLIC_BASE_URL;
  process.env.WAHA_API_KEY = 'test-key';
  delete require.cache[require.resolve('../services/providerInboundIntelligenceService')];
  const { downloadProviderMedia } = require('../services/providerInboundIntelligenceService');
  let header = null;
  const result = await downloadProviderMedia({
    url: 'https://waha.elankav.com/api/files/ELANKAV/file.pdf',
    fetchImpl: async (_url, init) => {
      header = init.headers['X-Api-Key'];
      return new Response(Buffer.from('pdf'), { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
  });
  assert.equal(header, 'test-key');
  assert.equal(result.buffer.toString(), 'pdf');
  for (const [name, value] of Object.entries({ WAHA_BASE_URL: previous.base, WAHA_INTERNAL_BASE_URL: previous.internal, WAHA_PUBLIC_BASE_URL: previous.public, WAHA_API_KEY: previous.key })) value === undefined ? delete process.env[name] : process.env[name] = value;
});
