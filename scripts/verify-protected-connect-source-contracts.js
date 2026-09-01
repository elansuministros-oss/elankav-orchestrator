#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(code, detail) {
  const error = new Error(detail || code);
  error.code = code;
  throw error;
}

function assertIncludes(source, needle, code) {
  if (!source.includes(needle)) fail(code, `${code}: missing ${needle}`);
}

function verifyProviderRecruitment(connectRepo) {
  const file = path.join(connectRepo, 'src/modules/providers/provider-recruitment.routes.ts');
  const source = fs.readFileSync(file, 'utf8');

  assertIncludes(source, "PROVIDER_CONTACT_BLOCKED", 'PROVIDER_RECRUITMENT_BLOCK_GATE_MISSING');
  assertIncludes(source, "PROVIDER_CONTACT_NOT_VERIFIED", 'PROVIDER_RECRUITMENT_VERIFY_GATE_MISSING');
  assertIncludes(source, "PROVIDER_CONTACT_MISSING", 'PROVIDER_RECRUITMENT_CONTACT_GATE_MISSING');
  assertIncludes(source, "contactOwnershipConfirmed", 'PROVIDER_RECRUITMENT_OWNERSHIP_EVIDENCE_MISSING');
  assertIncludes(source, "followupAttempts>=2", 'PROVIDER_RECRUITMENT_FOLLOWUP_BOUND_MISSING');
  assertIncludes(source, "nextFollowupAt:null", 'PROVIDER_RECRUITMENT_RESPONSE_STOP_MISSING');
  assertIncludes(source, "/recruitment/contact-preflight", 'PROVIDER_RECRUITMENT_PREFLIGHT_ROUTE_MISSING');
  assertIncludes(source, "/recruitment/contact-attempts", 'PROVIDER_RECRUITMENT_AUDIT_ROUTE_MISSING');
  assertIncludes(source, "PROVIDER_AUTONOMOUS_INVESTIGATION_DISABLED", 'PROVIDER_AUTONOMOUS_FLAG_GATE_MISSING');
  assertIncludes(source, "/recruitment/autonomous-research", 'PROVIDER_AUTONOMOUS_RESEARCH_ROUTE_MISSING');
  assertIncludes(source, "PROVIDER_AUTONOMOUS_ALREADY_CONTACTED", 'PROVIDER_AUTONOMOUS_DEDUPE_GATE_MISSING');
  assertIncludes(source, "verifiedAutonomousContact", 'PROVIDER_AUTONOMOUS_VERIFIED_CONTACT_MISSING');

  return 'PROVIDER_RECRUITMENT_CONNECT_CONTRACT_OK';
}

function main() {
  const contract = String(process.argv[2] || '').trim();
  const connectRepo = path.resolve(process.argv[3] || '/opt/elankav/connect');

  if (contract === 'provider_recruitment') {
    process.stdout.write(verifyProviderRecruitment(connectRepo) + '\n');
    return;
  }

  fail('PROTECTED_CONNECT_SOURCE_CONTRACT_UNKNOWN');
}

try {
  main();
} catch (error) {
  console.error(error.code || error.message);
  process.exit(1);
}
