'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Orchestrator shows ELAN GO inside the ecosystem service grid', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'server.js'),
    'utf8'
  );

  assert.match(source, /name:\s*'ELAN GO'/);
  assert.match(source, /url:\s*'https:\/\/go\.elankav\.com'/);
  assert.match(source, /service:\s*'elan-go-web'/);
  assert.doesNotMatch(source, /class="elan-go-panel"/);
});
