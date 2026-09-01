'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { listCustomers } = require('../services/ownerBusinessConnectClient');

test('listCustomers consulta exclusivamente el directorio oficial de CONNECT', async () => {
  const originalFetch = global.fetch;
  let requestedUrl = '';

  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { count: 0, results: [] } })
    };
  };

  try {
    await listCustomers({
      CONNECT_BASE_URL: 'https://connect.elankav.com',
      VQS_API_TOKEN: 'test-token'
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(
    requestedUrl,
    'https://connect.elankav.com/api/v1/business/vqs/customers/official'
  );
});
