const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REQUIRED_PERMISSION,
  getVscodeServiceStatus
} = require('../services/vscodeService');

test('VS Code Web rechaza acceso sin permiso', async () => {
  await assert.rejects(
    () => getVscodeServiceStatus({ hasPermission: false }),
    error => error.code === 'VSCODE_ACCESS_DENIED'
  );
});

test('VS Code Web expone únicamente estado y workspace en modo lectura', async () => {
  const result = await getVscodeServiceStatus({
    actor: '50588388940',
    hasPermission: true,
    runtimeStatusProvider: async () => ({
      configured: true,
      reachable: true,
      healthy: true,
      statusCode: 200,
      checkedAt: '2026-07-12T00:00:00.000Z'
    })
  });

  assert.equal(result.state, 'AVAILABLE');
  assert.equal(result.accessMode, 'read-only');
  assert.equal(result.requiredPermission, REQUIRED_PERMISSION);
  assert.equal(result.actor, '50588388940');
  assert.equal(result.workspaces.length, 1);
  assert.equal(result.restrictions.directGithub, false);
  assert.equal(result.restrictions.directDocker, false);
  assert.equal(result.restrictions.directSupabase, false);
  assert.equal(result.restrictions.directWaha, false);
  assert.equal(result.restrictions.directProduction, false);
  assert.equal(result.restrictions.shellExecution, false);
  assert.equal(result.restrictions.fileMutation, false);
});
