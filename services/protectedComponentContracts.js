'use strict';

const path = require('node:path');

const CONTRACT_SPECS = Object.freeze({
  owner_whatsapp_core: Object.freeze({
    kind: 'builtin',
    label: 'OWNER_WHATSAPP_CORE'
  }),
  owner_prospecting_bridge: Object.freeze({
    kind: 'node_test',
    label: 'OWNER_PROSPECTING_BRIDGE',
    files: Object.freeze([
      'test/ownerProspectingCommandService.test.js',
      'test/runtimeBootstrapPreloads.test.js',
      'test/sellerBusinessRuntimeOwnerBypass.test.js'
    ])
  }),
  provider_recruitment_orchestrator: Object.freeze({
    kind: 'node_test',
    label: 'PROVIDER_RECRUITMENT_ORCHESTRATOR',
    files: Object.freeze([
      'test/ownerProviderRecruitmentMessagePatch.test.js',
      'test/providerRecruitmentFollowupWorkerService.test.js',
      'test/providerAutonomousInvestigation.test.js',
      'tests/ownerProviderMessageRegression.test.js',
      'tests/ownerProviderStructuredContinuity.test.js'
    ])
  }),
  prospecting_research_connect: Object.freeze({
    kind: 'vitest',
    label: 'PROSPECTING_RESEARCH_AUTOPILOT',
    files: Object.freeze([
      'tests/prospecting-missions.test.ts',
      'tests/prospecting-autopilot.test.ts',
      'tests/prospecting-api.test.ts',
      'tests/prospecting-outreach-autopilot.test.ts'
    ])
  }),
  provider_recruitment_connect: Object.freeze({
    kind: 'source_contract',
    label: 'PROVIDER_RECRUITMENT_CONNECT',
    script: 'scripts/verify-protected-connect-source-contracts.js',
    args: Object.freeze(['provider_recruitment'])
  }),
  elan_go_control_connect: Object.freeze({
    kind: 'vitest',
    label: 'ELAN_GO_CONTROL',
    files: Object.freeze([
      'tests/marketplace-elan-go-control.test.ts',
      'tests/marketplace-runtime.test.ts'
    ])
  })
});

function getProtectedContractSpec(contract) {
  const key = String(contract || '').trim();
  const spec = CONTRACT_SPECS[key];
  if (!spec) {
    const error = new Error('PROTECTED_COMPONENT_CONTRACT_NOT_IMPLEMENTED');
    error.code = 'PROTECTED_COMPONENT_CONTRACT_NOT_IMPLEMENTED';
    throw error;
  }
  return spec;
}

function resolveVitestBinary(repo) {
  return path.join(repo, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest');
}

module.exports = {
  CONTRACT_SPECS,
  getProtectedContractSpec,
  resolveVitestBinary
};
