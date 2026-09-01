'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OWNER_COMMANDS,
  detectOwnerCommand
} = require('../services/ownerCommandService');

const COMMIT =
  '1234567890abcdef1234567890abcdef12345678';

test('WhatsApp detecta deploy controlado de Orchestrator con commit exacto', () => {
  const command = detectOwnerCommand(
    `ELAN despliega Orchestrator commit ${COMMIT}`
  );

  assert.equal(
    command?.type,
    OWNER_COMMANDS.OWNER_OPS_PREPARE_SENSITIVE
  );

  assert.equal(
    command?.capability,
    'repository.deploy'
  );

  assert.equal(
    command?.target,
    'orchestrator'
  );

  assert.equal(
    command?.parameters?.expectedCommit,
    COMMIT
  );

  assert.equal(
    command?.parameters?.restart,
    true
  );
});

test('WhatsApp detecta deploy controlado de CONNECT', () => {
  const command = detectOwnerCommand(
    `ELAN despliega CONNECT commit ${COMMIT}`
  );

  assert.equal(
    command?.capability,
    'repository.deploy'
  );

  assert.equal(
    command?.target,
    'connect'
  );
});

test('commit corto no prepara repository.deploy', () => {
  const command = detectOwnerCommand(
    'ELAN despliega Orchestrator commit 84bc599'
  );

  assert.notEqual(
    command?.capability,
    'repository.deploy'
  );
});

test('consulta estado de una operación OPS', () => {
  const command = detectOwnerCommand(
    'ELAN estado OPS-1786850409219-ABC123'
  );

  assert.equal(
    command?.type,
    OWNER_COMMANDS.OPS_STATUS
  );

  assert.equal(
    command?.operationId,
    'OPS-1786850409219-ABC123'
  );
});
