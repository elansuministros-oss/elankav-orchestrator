'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-protected-connect-source-contracts.js');

function makeRepo(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elankav-protected-connect-'));
  const dir = path.join(root, 'src', 'modules', 'providers');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'provider-recruitment.routes.ts'), source);
  return root;
}

function runContract(repo) {
  return spawnSync(process.execPath, [SCRIPT, 'provider_recruitment', repo], {
    encoding: 'utf8'
  });
}

test('provider recruitment source contract acepta todos los gates protegidos', () => {
  const source = [
    "PROVIDER_CONTACT_BLOCKED",
    "PROVIDER_CONTACT_NOT_VERIFIED",
    "PROVIDER_CONTACT_MISSING",
    "contactOwnershipConfirmed",
    "followupAttempts>=2",
    "nextFollowupAt:null",
    "/recruitment/contact-preflight",
    "/recruitment/contact-attempts",
    "PROVIDER_AUTONOMOUS_INVESTIGATION_DISABLED",
    "/recruitment/autonomous-research",
    "PROVIDER_AUTONOMOUS_ALREADY_CONTACTED",
    "verifiedAutonomousContact"
  ].join('\n');

  const result = runContract(makeRepo(source));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PROVIDER_RECRUITMENT_CONNECT_CONTRACT_OK/);
});

test('provider recruitment source contract falla cerrado si desaparece verificación', () => {
  const source = [
    "PROVIDER_CONTACT_BLOCKED",
    "PROVIDER_CONTACT_MISSING",
    "contactOwnershipConfirmed",
    "followupAttempts>=2",
    "nextFollowupAt:null",
    "/recruitment/contact-preflight",
    "/recruitment/contact-attempts",
    "PROVIDER_AUTONOMOUS_INVESTIGATION_DISABLED",
    "/recruitment/autonomous-research",
    "PROVIDER_AUTONOMOUS_ALREADY_CONTACTED",
    "verifiedAutonomousContact"
  ].join('\n');

  const result = runContract(makeRepo(source));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PROVIDER_RECRUITMENT_VERIFY_GATE_MISSING/);
});
