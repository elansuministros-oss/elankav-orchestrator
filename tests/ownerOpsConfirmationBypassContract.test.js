'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'inboundCommercialRoleMessagePatch.js'),
  'utf8'
);

assert.match(source, /OWNER_OPS_CONTROL_PATTERN/);
assert.match(source, /confirmar\\s\+OPS-/i);
assert.match(source, /OWNER_OPS_CONTROL_PATTERN\.test\(message\)/);

console.log('OWNER_OPS_CONFIRMATION_BYPASS_CONTRACT_OK');
