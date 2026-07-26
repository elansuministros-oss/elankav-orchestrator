'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRelativePath,
  assertAllowedTextPath,
  isBlocked,
  redactSecrets
} = require('../services/workspaceSecurityService');

test('rechaza traversal y rutas absolutas', () => {
  assert.throws(() => normalizeRelativePath('../etc/passwd'), { code: 'WORKSPACE_PATH_DENIED' });
  assert.throws(() => normalizeRelativePath('/etc/passwd'), { code: 'WORKSPACE_PATH_INVALID' });
});

test('bloquea secretos y tipos no permitidos', () => {
  assert.equal(isBlocked('.env.production'), true);
  assert.equal(isBlocked('.ssh/id_rsa'), true);
  assert.equal(isBlocked('.git/config'), true);
  assert.throws(() => assertAllowedTextPath('private.pem'), { code: 'WORKSPACE_RESOURCE_BLOCKED' });
  assert.throws(() => assertAllowedTextPath('image.png'), { code: 'WORKSPACE_FILE_TYPE_DENIED' });
});

test('permite archivos de texto y redacta credenciales', () => {
  assert.equal(assertAllowedTextPath('src/service.js'), 'src/service.js');
  assert.equal(redactSecrets('api_key=abc123'), 'api_key=[REDACTED]');
  assert.equal(redactSecrets('password: secret'), 'password: [REDACTED]');
});
