'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CAPABILITIES
} = require('../services/ownerOpsCapabilityRegistry');

const {
  readFileInspect,
  resolveFileSpec,
  resolveTestSuite,
  runTestSuite
} = require('../services/ownerOpsReadService');

const {
  detectOwnerCommand,
  OWNER_COMMANDS
} = require('../services/ownerCommandService');


test('file.inspect and test.run are registered as READ capabilities', () => {
  assert.equal(CAPABILITIES['file.inspect']?.risk, 'READ');
  assert.equal(CAPABILITIES['test.run']?.risk, 'READ');
});


test('resolves only registered Owner OPS file aliases', () => {
  assert.equal(
    resolveFileSpec('orchestrator-owner-command')?.path,
    '/opt/elankav/orchestrator/services/ownerCommandService.js'
  );

  assert.equal(
    resolveFileSpec('../../etc/shadow'),
    null
  );

  assert.equal(
    resolveFileSpec('.env'),
    null
  );
});


test('resolves only registered test suites', () => {
  assert.equal(
    resolveTestSuite('orchestrator-owner-language')?.file,
    'tests/ownerLanguageProfile.test.js'
  );

  assert.equal(
    resolveTestSuite('rm -rf /'),
    null
  );
});


test('Owner router detects authorized file inspection request', () => {
  const command = detectOwnerCommand(
    'ELAN revisa el archivo ownerCommandService.js'
  );

  assert.equal(command?.type, OWNER_COMMANDS.OWNER_OPS_READ);
  assert.equal(command?.capability, 'file.inspect');
  assert.equal(
    command?.fileAlias,
    'orchestrator-owner-command'
  );
});


test('Owner router detects controlled Owner Language test request', () => {
  const command = detectOwnerCommand(
    'ELAN ejecuta los tests Owner Language'
  );

  assert.equal(command?.type, OWNER_COMMANDS.OWNER_OPS_READ);
  assert.equal(command?.capability, 'test.run');
  assert.equal(
    command?.suite,
    'orchestrator-owner-language'
  );
});


test('file.inspect reads an authorized operational source file', async () => {
  const result = await readFileInspect(
    'orchestrator-owner-command'
  );

  assert.equal(result.capability, 'file.inspect');
  assert.match(result.content, /detectOwnerCommand/);
  assert.ok(result.size > 0);
});


test('file.inspect rejects arbitrary file paths', async () => {
  await assert.rejects(
    readFileInspect('../../etc/passwd'),
    error =>
      error?.code === 'OWNER_OPS_FILE_NOT_ALLOWED'
  );
});


test('test.run executes only a registered suite', async () => {
  const result = await runTestSuite(
    'orchestrator-owner-language'
  );

  assert.equal(result.capability, 'test.run');
  assert.equal(result.success, true);
  assert.match(result.output, /pass 11/);
  assert.match(result.output, /fail 0/);
});


test('test.run rejects arbitrary commands', async () => {
  await assert.rejects(
    runTestSuite('bash -c whoami'),
    error =>
      error?.code === 'OWNER_OPS_TEST_NOT_ALLOWED'
  );
});
