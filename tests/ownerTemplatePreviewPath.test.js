'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestProspecting } = require('../services/ownerProspectingCommandService');

test('permite el endpoint exacto de prueba Owner de plantilla', async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, status: 200, async json() { return { ok: true }; } };
  };
  try {
    const env = { CONNECT_BASE_URL: 'https://connect.example.test', CONNECT_INTERNAL_API_TOKEN: 'test-token' };
    const result = await requestProspecting(
      '/console/api/prospecting/templates/11111111-1111-4111-8111-111111111111/owner-test',
      { method: 'POST' },
      env
    );
    assert.equal(result.ok, true);
    assert.equal(requestedUrl, 'https://connect.example.test/console/api/prospecting/templates/11111111-1111-4111-8111-111111111111/owner-test');
  } finally {
    global.fetch = originalFetch;
  }
});
