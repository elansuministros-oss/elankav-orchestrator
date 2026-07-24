'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConnectClient } = require('../adapters/connectClient');

test('ConnectClient construye una consulta permitida a CONNECT', async () => {
  const calls = [];
  const client = new ConnectClient({
    baseUrl: 'http://connect.test/',
    internalToken: 'internal',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => [{ id: 'lead-1' }]
      };
    }
  });

  const result = await client.request({
    path: '/api/v1/leads',
    query: { status: 'new', empty: '' }
  });

  assert.deepEqual(result, [{ id: 'lead-1' }]);
  assert.equal(calls[0].url, 'http://connect.test/api/v1/leads?status=new');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer internal');
  assert.equal(calls[0].options.headers['X-Elankav-Platform'], 'elan-ai');
});

test('ConnectClient rechaza rutas fuera de CONNECT API', async () => {
  const client = new ConnectClient({
    fetchImpl: async () => {
      throw new Error('no debe llamarse');
    }
  });

  await assert.rejects(
    client.request({ path: 'https://example.com' }),
    /CONNECT_PATH_INVALID/
  );
});
