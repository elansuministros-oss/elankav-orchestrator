'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { detectOwnerCommand, executeOwnerCommand } = require('../services/ownerCommandService');

test('natural operational commands persist non-exclusive Owner state', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-owner-op-'));
  const previous = process.env.OPERATOR_MODE_STORE_PATH;
  process.env.OPERATOR_MODE_STORE_PATH = path.join(dir, 'modes.json');
  t.after(() => previous === undefined ? delete process.env.OPERATOR_MODE_STORE_PATH : (process.env.OPERATOR_MODE_STORE_PATH = previous));
  let result = await executeOwnerCommand({ command: detectOwnerCommand('ELAN actívate'), platform: 'elanvisual' });
  assert.equal(result.operatorMode.operationalControls.autonomy, true);
  result = await executeOwnerCommand({ command: detectOwnerCommand('Desactiva proveedores'), platform: 'elanvisual' });
  assert.equal(result.operatorMode.operationalControls.providers, false);
  result = await executeOwnerCommand({ command: detectOwnerCommand('Activa modo copiloto'), platform: 'elanvisual' });
  assert.equal(result.operatorMode.operationalControls.copilot, true);
  result = await executeOwnerCommand({ command: detectOwnerCommand('Pausa'), platform: 'elanvisual' });
  assert.deepEqual(result.operatorMode.operationalControls, { autonomy: false, sales: true, providers: false, copilot: true });
});
