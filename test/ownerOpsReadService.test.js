'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getCapability,
  resolveRepository,
  resolveService
} = require('../services/ownerOpsCapabilityRegistry');
const { sanitizeOutput } = require('../services/ownerOpsReadService');

test('owner ops exposes only registered READ capabilities', () => {
  assert.equal(getCapability('server.summary').risk, 'READ');
  assert.equal(getCapability('service.status').risk, 'READ');
  assert.equal(getCapability('service.logs').risk, 'READ');
  assert.equal(getCapability('git.status').risk, 'READ');
  assert.equal(getCapability('shell.exec'), null);
});

test('owner ops restricts services and repositories to ELANKAV allowlist', () => {
  assert.equal(resolveService('connect'), 'elankav-connect.service');
  assert.equal(resolveService('orchestrator'), 'elankav-orchestrator.service');
  assert.equal(resolveService('ssh'), null);

  assert.equal(resolveRepository('connect'), '/opt/elankav/connect');
  assert.equal(resolveRepository('orchestrator'), '/opt/elankav/orchestrator');
  assert.equal(resolveRepository('../../etc'), null);
});

test('sanitizer redacts common secret forms', () => {
  const source = [
    'Authorization: Bearer abc123',
    'API_KEY=secret-value',
    'TOKEN: another-secret',
    'https://user:password@example.com/path'
  ].join('\n');

  const sanitized = sanitizeOutput(source);

  assert.doesNotMatch(sanitized, /abc123/);
  assert.doesNotMatch(sanitized, /secret-value/);
  assert.doesNotMatch(sanitized, /another-secret/);
  assert.doesNotMatch(sanitized, /password@example/);
  assert.match(sanitized, /\[REDACTED\]/);
});
