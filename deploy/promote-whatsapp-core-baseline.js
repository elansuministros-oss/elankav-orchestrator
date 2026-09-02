#!/usr/bin/env node
'use strict';

const {
  TARGETS,
  markWhatsappCoreGood,
  readOrchestratorRepoState,
  runWhatsappCoreContract,
  verifyOrchestratorHttpHealth,
  verifyWhatsappBridgeHealth
} = require('../bin/owner-ops-supervisor');

function expectedSha() {
  const value = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) {
    const error = new Error('EXPECTED_SHA40_REQUIRED');
    error.code = 'EXPECTED_SHA40_REQUIRED';
    throw error;
  }
  return value;
}

async function main() {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || process.getuid() !== 0) {
    throw Object.assign(new Error('ROOT_REQUIRED'), { code: 'ROOT_REQUIRED' });
  }

  const expected = expectedSha();
  const repoState = await readOrchestratorRepoState();

  if (repoState.branch !== TARGETS.orchestrator.branch) {
    throw Object.assign(new Error('WHATSAPP_CORE_PROMOTION_BRANCH_MISMATCH'), { code: 'WHATSAPP_CORE_PROMOTION_BRANCH_MISMATCH' });
  }
  if (repoState.dirty) {
    throw Object.assign(new Error('WHATSAPP_CORE_PROMOTION_REPO_DIRTY'), { code: 'WHATSAPP_CORE_PROMOTION_REPO_DIRTY' });
  }
  if (repoState.sha.toLowerCase() !== expected) {
    throw Object.assign(new Error('WHATSAPP_CORE_PROMOTION_SHA_MISMATCH'), { code: 'WHATSAPP_CORE_PROMOTION_SHA_MISMATCH' });
  }

  const contract = await runWhatsappCoreContract(TARGETS.orchestrator.repo);
  const healthEndpoint = await verifyOrchestratorHttpHealth();
  const bridgeEndpoint = await verifyWhatsappBridgeHealth();
  const state = await markWhatsappCoreGood({ source: 'vscode_validated_bootstrap' });

  process.stdout.write(JSON.stringify({
    ok: true,
    promotedSha: state.lastGoodSha,
    branch: state.branch,
    contract,
    healthEndpoint,
    bridgeEndpoint,
    source: state.source
  }, null, 2) + '\n');
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code || 'WHATSAPP_CORE_PROMOTION_FAILED',
    error: error?.message || 'WHATSAPP_CORE_PROMOTION_FAILED'
  }));
  process.exit(1);
});
