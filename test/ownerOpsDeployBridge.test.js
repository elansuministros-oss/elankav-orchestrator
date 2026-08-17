'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { confirmOperation, detectOwnerOpsDeployCommand, prepareDeploy, statusOperation } = require('../services/ownerOpsDeployBridge');

function testEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'elan-owner-ops-'));
  return { base, env: { OWNER_OPS_STORE_PATH: path.join(base, 'operations.json'), OWNER_OPS_SUPERVISOR_DIR: path.join(base, 'supervisor') } };
}

test('detecta despliegue CONNECT con SHA completo', () => {
  const sha = '0e8b0a06e6dc92eb738878bd19a6391cca1acd33';
  assert.deepEqual(detectOwnerOpsDeployCommand(`ELAN despliega CONNECT commit ${sha}`), { type: 'owner_ops_prepare_deploy', target: 'connect', commit: sha });
});

test('prepara, confirma y delega repository.deploy al supervisor', async () => {
  const sha = '0e8b0a06e6dc92eb738878bd19a6391cca1acd33';
  const { base, env } = testEnv();
  const prepared = await prepareDeploy(detectOwnerOpsDeployCommand(`ELAN despliega CONNECT commit ${sha}`), env);
  assert.match(prepared.job.id, /^OPS-\d+-[A-Z0-9]{6}$/);
  assert.equal(prepared.job.result.operation.capability, 'repository.deploy');
  assert.equal(prepared.job.result.operation.parameters.expectedCommit, sha);
  const confirmation = detectOwnerOpsDeployCommand(`CONFIRMAR ${prepared.job.id}`);
  assert.equal(confirmation.type, 'owner_ops_confirm');
  await confirmOperation(confirmation, env);
  const request = JSON.parse(fs.readFileSync(path.join(base, 'supervisor', 'requests', `${prepared.job.id}.json`), 'utf8'));
  assert.equal(request.capability, 'repository.deploy');
  assert.equal(request.target, 'connect');
  assert.equal(request.parameters.expectedCommit, sha);
  assert.equal(request.parameters.install, true);
  assert.equal(request.parameters.restart, true);
});

test('consulta resultado verificado del supervisor', async () => {
  const sha = '0e8b0a06e6dc92eb738878bd19a6391cca1acd33';
  const { base, env } = testEnv();
  const prepared = await prepareDeploy(detectOwnerOpsDeployCommand(`ELAN despliega CONNECT commit ${sha}`), env);
  await confirmOperation(detectOwnerOpsDeployCommand(`CONFIRMAR ${prepared.job.id}`), env);
  const resultDir = path.join(base, 'supervisor', 'results');
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(path.join(resultDir, `${prepared.job.id}.json`), JSON.stringify({ id: prepared.job.id, status: 'completed', execution: { capability: 'repository.deploy', target: 'connect', after: sha, service: 'elankav-connect.service', status: 'active' } }));
  const status = await statusOperation(detectOwnerOpsDeployCommand(`ELAN estado ${prepared.job.id}`), env);
  assert.equal(status.ownerOps.status, 'completed');
  assert.equal(status.ownerOps.execution.after, sha);
});
