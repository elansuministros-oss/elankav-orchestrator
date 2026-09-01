'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MODES,
  canUseModeCapability,
  setOperatorMode
} = require('../services/operatorModeService');

const {
  OWNER_COMMANDS,
  detectOwnerCommand,
  executeOwnerCommand
} = require('../services/ownerCommandService');

const {
  createPendingOperation
} = require('../services/ownerOpsConfirmationService');


let tempDir;
let previousModeStore;
let previousOpsStore;


test.before(async () => {
  tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'owner-mode-permissions-')
  );

  previousModeStore =
    process.env.OPERATOR_MODE_STORE_PATH;

  previousOpsStore =
    process.env.OWNER_OPS_STORE_DIR;

  process.env.OPERATOR_MODE_STORE_PATH =
    path.join(tempDir, 'operator-modes.json');

  process.env.OWNER_OPS_STORE_DIR =
    path.join(tempDir, 'owner-ops');
});


test.after(async () => {
  if (previousModeStore === undefined) {
    delete process.env.OPERATOR_MODE_STORE_PATH;
  } else {
    process.env.OPERATOR_MODE_STORE_PATH =
      previousModeStore;
  }

  if (previousOpsStore === undefined) {
    delete process.env.OWNER_OPS_STORE_DIR;
  } else {
    process.env.OWNER_OPS_STORE_DIR =
      previousOpsStore;
  }

  await fs.rm(tempDir, {
    recursive: true,
    force: true
  });
});


test('technical Owner OPS capabilities require PROGRAMADOR', () => {
  assert.equal(
    canUseModeCapability(
      MODES.VENTAS,
      'service.restart'
    ),
    false
  );

  assert.equal(
    canUseModeCapability(
      MODES.VENTAS,
      'test.run'
    ),
    false
  );

  assert.equal(
    canUseModeCapability(
      MODES.PROGRAMADOR,
      'service.restart'
    ),
    true
  );

  assert.equal(
    canUseModeCapability(
      MODES.PROGRAMADOR,
      'test.run'
    ),
    true
  );
});


test('question about restart is informational, not an execution request', () => {
  const command = detectOwnerCommand(
    'ELAN, ¿podés reiniciar el Orchestrator estando en modo VENTAS?'
  );

  assert.equal(
    command?.type,
    OWNER_COMMANDS.MODE_PERMISSIONS
  );
});


test('explicit permission question does not prepare sensitive operation', () => {
  const command = detectOwnerCommand(
    'ELAN, SOLO INFORMACIÓN, NO EJECUTES NADA: ¿service.restart está permitido en mi modo actual?'
  );

  assert.equal(
    command?.type,
    OWNER_COMMANDS.MODE_PERMISSIONS
  );
});


test('explicit restart command is still recognized as sensitive', () => {
  const command = detectOwnerCommand(
    'ELAN reinicia Orchestrator'
  );

  assert.equal(
    command?.type,
    OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE
  );

  assert.equal(
    command?.capability,
    'service.restart'
  );
});


test('VENTAS blocks technical READ execution', async () => {
  await setOperatorMode({
    operatorId: 'owner',
    role: 'OWNER',
    mode: MODES.VENTAS
  });

  const result = await executeOwnerCommand({
    command: {
      type: OWNER_COMMANDS.OWNER_OPS_READ,
      capability: 'test.run',
      target: 'orchestrator',
      suite: 'orchestrator-owner-language'
    },
    platform: 'elan-ai'
  });

  assert.equal(result.ownerOps, null);
  assert.match(
    result.outputText,
    /bloqueada por modo/i
  );
  assert.match(
    result.outputText,
    /VENTAS/
  );
  assert.match(
    result.outputText,
    /PROGRAMADOR/
  );
});


test('VENTAS does not prepare a technical sensitive operation', async () => {
  await setOperatorMode({
    operatorId: 'owner',
    role: 'OWNER',
    mode: MODES.VENTAS
  });

  const result = await executeOwnerCommand({
    command: {
      type:
        OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE,
      capability: 'service.restart',
      target: 'orchestrator',
      summary: 'Reiniciar Orchestrator',
      impact: 'Test',
      parameters: {}
    },
    platform: 'elan-ai'
  });

  assert.equal(result.job, null);
  assert.equal(result.ownerOps, null);

  assert.match(
    result.outputText,
    /bloqueada por modo/i
  );
});


test('confirmation rechecks current mode before technical execution', async () => {
  await setOperatorMode({
    operatorId: 'owner',
    role: 'OWNER',
    mode: MODES.PROGRAMADOR
  });

  const pending = await createPendingOperation({
    capability: 'service.restart',
    target: 'orchestrator',
    summary: 'Reiniciar Orchestrator',
    impact: 'Test controlado',
    parameters: {}
  });

  await setOperatorMode({
    operatorId: 'owner',
    role: 'OWNER',
    mode: MODES.VENTAS
  });

  const result = await executeOwnerCommand({
    command: {
      type: OWNER_COMMANDS.OWNER_OPS_CONFIRM,
      operationId: pending.id
    },
    platform: 'elan-ai'
  });

  assert.equal(result.ownerOps, null);

  assert.match(
    result.outputText,
    /bloqueada por modo/i
  );

  assert.match(
    result.outputText,
    /VENTAS/
  );
});


test('permission audit reports technical capabilities blocked in VENTAS', async () => {
  await setOperatorMode({
    operatorId: 'owner',
    role: 'OWNER',
    mode: MODES.VENTAS
  });

  const result = await executeOwnerCommand({
    command: {
      type: OWNER_COMMANDS.MODE_PERMISSIONS
    },
    platform: 'elan-ai'
  });

  assert.match(result.outputText, /Modo activo: VENTAS/);
  assert.match(result.outputText, /service.restart/);
  assert.match(
    result.outputText,
    /BLOQUEADAS EN ESTE MODO/
  );
});


test('permission audit exposes technical access in PROGRAMADOR', async () => {
  await setOperatorMode({
    operatorId: 'owner',
    role: 'OWNER',
    mode: MODES.PROGRAMADOR
  });

  const result = await executeOwnerCommand({
    command: {
      type: OWNER_COMMANDS.MODE_PERMISSIONS
    },
    platform: 'elan-ai'
  });

  assert.match(
    result.outputText,
    /Modo activo: PROGRAMADOR/
  );

  assert.match(result.outputText, /test.run/);
  assert.match(result.outputText, /service.restart/);
  assert.match(
    result.outputText,
    /REQUIEREN CONFIRMACIÓN/
  );
});
