'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OWNER_COMMANDS,
  detectOwnerCommand,
  executeOwnerCommand
} = require('../services/ownerCommandService');

const {
  getModeTechnicalCapabilities
} = require('../services/operatorModeService');

test('correccion tecnica se deriva a ChatGPT sin crear Job automatico', async () => {
  const command = detectOwnerCommand(
    'ELAN corrige Orchestrator: agrega una prueba tecnica'
  );

  assert.equal(command?.type, OWNER_COMMANDS.CODE_JOB);
  assert.equal(command?.platform, 'orchestrator');

  const result = await executeOwnerCommand({
    command,
    platform: 'orchestrator'
  });

  assert.equal(result.job, null);
  assert.equal(
    result.developmentHandoff?.automaticCodeGeneration,
    false
  );

  assert.match(
    result.outputText,
    /generación automática de código.*deshabilitada/i
  );

  assert.match(
    result.outputText,
    /ChatGPT/i
  );

  assert.match(
    result.outputText,
    /no ejecutó Codex/i
  );
});

test('PROGRAMADOR ya no expone code.prepare', () => {
  const capabilities =
    getModeTechnicalCapabilities('PROGRAMADOR');

  assert.equal(
    capabilities.includes('code.prepare'),
    false
  );
});
