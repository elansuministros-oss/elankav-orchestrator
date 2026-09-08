'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getOperatorState, setOperatorMode, setOperationalControl } = require('../services/operatorModeService');

test('operational controls coexist and survive role-mode changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-op-control-'));
  const env = { OPERATOR_MODE_STORE_PATH: path.join(dir, 'modes.json') };
  await setOperationalControl({ operatorId: 'owner', role: 'OWNER', scope: 'sales', enabled: true, env });
  await setOperationalControl({ operatorId: 'owner', role: 'OWNER', scope: 'providers', enabled: true, env });
  await setOperationalControl({ operatorId: 'owner', role: 'OWNER', scope: 'autonomy', enabled: true, env });
  let state = await getOperatorState({ operatorId: 'owner', role: 'OWNER', env });
  assert.deepEqual(state.operationalControls, { autonomy: true, sales: true, providers: true, copilot: false });
  await setOperationalControl({ operatorId: 'owner', role: 'OWNER', scope: 'autonomy', enabled: false, env });
  await setOperatorMode({ operatorId: 'owner', role: 'OWNER', mode: 'ventas', env });
  state = await getOperatorState({ operatorId: 'owner', role: 'OWNER', env });
  assert.equal(state.activeMode, 'VENTAS');
  assert.deepEqual(state.operationalControls, { autonomy: false, sales: true, providers: true, copilot: false });
});
