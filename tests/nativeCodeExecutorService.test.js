'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_WRITES,
  isAllowedTextPath,
  extractJson
} = require('../services/nativeCodeExecutorService');

test('permite archivos de código y configuración no sensibles', () => {
  assert.equal(isAllowedTextPath('services/jobs/jobPipeline.js'), true);
  assert.equal(isAllowedTextPath('tests/example.test.js'), true);
  assert.equal(isAllowedTextPath('package.json'), true);
});

test('bloquea rutas fuera del workspace', () => {
  assert.equal(isAllowedTextPath('../etc/passwd'), false);
  assert.equal(isAllowedTextPath('/etc/passwd'), false);
});

test('bloquea secretos y archivos de autenticación', () => {
  assert.equal(isAllowedTextPath('.env'), false);
  assert.equal(isAllowedTextPath('config/.env.production'), false);
  assert.equal(isAllowedTextPath('auth.json'), false);
  assert.equal(isAllowedTextPath('config/private_key.pem'), false);
});

test('bloquea extensiones binarias', () => {
  assert.equal(isAllowedTextPath('assets/logo.png'), false);
  assert.equal(isAllowedTextPath('archive.zip'), false);
});

test('extrae JSON puro o dentro de fence', () => {
  const plain = extractJson('{"summary":"ok","files":[]}');
  assert.equal(plain.summary, 'ok');

  const fenced = extractJson('```json\n{"summary":"ok2","files":[]}\n```');
  assert.equal(fenced.summary, 'ok2');
});

test('limita cantidad de escrituras propuestas', () => {
  assert.ok(MAX_WRITES > 0);
  assert.ok(MAX_WRITES <= 12);
});
