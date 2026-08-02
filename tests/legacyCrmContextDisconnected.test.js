'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('messageService no carga el contexto CRM heredado', () => {
  const source = read('services/messageService.js');
  assert.doesNotMatch(source, /crmContextService|loadCrmContext/);
  assert.doesNotMatch(source, /context:\s*\{[\s\S]*?\bcrm\s*,/);
});

test('se eliminaron los adaptadores de contexto CRM legacy', () => {
  assert.equal(fs.existsSync(path.join(root, 'services/crmContextService.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'adapters/crmContextAdapter.js')), false);
});

test('el código activo no conserva rutas ni dominio del contexto CRM eliminado', () => {
  const source = read('services/messageService.js');
  assert.doesNotMatch(source, /elankav-connect\.vercel\.app/);
  assert.doesNotMatch(source, /\/api\/v1\/(business|leads|opportunities|quotes|orders)/);
});
