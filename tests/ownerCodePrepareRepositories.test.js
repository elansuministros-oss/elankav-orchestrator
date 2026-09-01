'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OWNER_COMMANDS,
  detectOwnerCommand,
  resolvePlatformFromMessage
} = require('../services/ownerCommandService');

const {
  resolveRepository
} = require('../services/repositoryWorkspaceService');


test('Orchestrator is an allowed code.prepare repository', () => {
  const repository = resolveRepository('orchestrator');

  assert.equal(
    repository.repo,
    'elankav-orchestrator'
  );

  assert.equal(
    repository.branch,
    'fix/AI-SALES-AUTONOMY-CONTEXT-INTEGRATED-01'
  );
});


test('CONNECT is an allowed code.prepare repository', () => {
  const repository = resolveRepository('connect');

  assert.equal(
    repository.repo,
    'elankav-connect'
  );

  assert.equal(
    repository.branch,
    'main'
  );
});


test('router resolves Orchestrator aliases', () => {
  assert.equal(
    resolvePlatformFromMessage(
      'elan corrige orchestrator'
    ),
    'orchestrator'
  );

  assert.equal(
    resolvePlatformFromMessage(
      'elan revisa el orquestador'
    ),
    'orchestrator'
  );
});


test('router resolves CONNECT aliases', () => {
  assert.equal(
    resolvePlatformFromMessage(
      'elan corrige connect'
    ),
    'connect'
  );

  assert.equal(
    resolvePlatformFromMessage(
      'elan modifica elankav connect'
    ),
    'connect'
  );
});


test('Orchestrator code modification creates CODE_JOB intent', () => {
  const command = detectOwnerCommand(
    'ELAN corrige Orchestrator: agrega una prueba controlada'
  );

  assert.equal(
    command?.type,
    OWNER_COMMANDS.CODE_JOB
  );

  assert.equal(
    command?.platform,
    'orchestrator'
  );
});


test('CONNECT code modification creates CODE_JOB intent', () => {
  const command = detectOwnerCommand(
    'ELAN modifica CONNECT: agrega una prueba controlada'
  );

  assert.equal(
    command?.type,
    OWNER_COMMANDS.CODE_JOB
  );

  assert.equal(
    command?.platform,
    'connect'
  );
});


test('read-only Orchestrator request does not create CODE_JOB', () => {
  const command = detectOwnerCommand(
    'ELAN solo lectura revisa Orchestrator'
  );

  assert.notEqual(
    command?.type,
    OWNER_COMMANDS.CODE_JOB
  );
});
