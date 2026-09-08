'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setOperationalControl } = require('../services/operatorModeService');
const { runProviderRecruitmentFollowups } = require('../services/providerRecruitmentFollowupWorkerService');

test('provider worker requires universal autonomy + providers gates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-provider-gate-'));
  const env = { OPERATOR_MODE_STORE_PATH: path.join(dir, 'modes.json'), PROVIDER_RECRUITMENT_FOLLOWUP_ENABLED: 'true' };
  const now = () => new Date('2026-09-08T16:00:00Z');
  const forbiddenFetch = async () => { throw new Error('FETCH_SHOULD_NOT_RUN'); };
  let result = await runProviderRecruitmentFollowups({ env, now, fetchImpl: forbiddenFetch });
  assert.equal(result.status, 'PAUSED_BY_OPERATOR');
  await setOperationalControl({ scope: 'autonomy', enabled: true, env });
  await setOperationalControl({ scope: 'providers', enabled: false, env });
  result = await runProviderRecruitmentFollowups({ env, now, fetchImpl: forbiddenFetch });
  assert.equal(result.status, 'PAUSED_BY_OPERATOR');
});
