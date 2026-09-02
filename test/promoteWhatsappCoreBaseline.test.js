'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('VS bootstrap promotion script is fail-closed and health-gated', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'deploy/promote-whatsapp-core-baseline.js'), 'utf8');
  assert.match(source, /EXPECTED_SHA40_REQUIRED/);
  assert.match(source, /WHATSAPP_CORE_PROMOTION_BRANCH_MISMATCH/);
  assert.match(source, /WHATSAPP_CORE_PROMOTION_REPO_DIRTY/);
  assert.match(source, /WHATSAPP_CORE_PROMOTION_SHA_MISMATCH/);
  assert.match(source, /runWhatsappCoreContract/);
  assert.match(source, /verifyOrchestratorHttpHealth/);
  assert.match(source, /verifyWhatsappBridgeHealth/);
  assert.match(source, /markWhatsappCoreGood/);
  assert.match(source, /vscode_validated_bootstrap/);
});
