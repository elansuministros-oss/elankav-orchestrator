'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getConfig
} = require('../adapters/crmContextAdapter');

test('CRM context usa primero el endpoint canónico de CONNECT', () => {
  const config = getConfig({
    ELANKAV_CONNECT_URL: 'https://connect.elankav.com/',
    CONNECT_API_URL: 'https://legacy.example/api',
    CONNECT_INTERNAL_API_TOKEN: 'TOKEN-A',
    CONNECT_INTERNAL_TOKEN: 'TOKEN-B'
  });

  assert.equal(config.baseUrl, 'https://connect.elankav.com');
  assert.equal(config.token, 'TOKEN-A');
});

test('CRM context conserva compatibilidad si solo existe CONNECT_API_URL', () => {
  const config = getConfig({
    CONNECT_API_URL: 'https://connect-fallback.example/',
    CRM_INTERNAL_TOKEN: 'CRM-TOKEN'
  });

  assert.equal(config.baseUrl, 'https://connect-fallback.example');
  assert.equal(config.token, 'CRM-TOKEN');
});
