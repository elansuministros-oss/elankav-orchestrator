'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CAPABILITIES
} = require('../services/ownerOpsCapabilityRegistry');

const {
  MODES,
  TECHNICAL_OWNER_OPS_CAPABILITIES,
  canUseModeCapability
} = require('../services/operatorModeService');

const {
  deriveChannelInternalToken,
  readChannelBridgeAudit,
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
  assert.equal(CAPABILITIES['channels.audit']?.risk, 'READ');
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


test('channels.audit is explicitly allowed in PROGRAMADOR mode', () => {
  assert.equal(
    TECHNICAL_OWNER_OPS_CAPABILITIES.includes('channels.audit'),
    true
  );
  assert.equal(
    canUseModeCapability(MODES.PROGRAMADOR, 'channels.audit'),
    true
  );
  assert.equal(
    canUseModeCapability(MODES.OWNER_GENERAL, 'channels.audit'),
    false
  );
});


test('Owner router detects read-only channel bridge audit request', () => {
  const command = detectOwnerCommand('ELAN audita canales');

  assert.equal(command?.type, OWNER_COMMANDS.OWNER_OPS_READ);
  assert.equal(command?.capability, 'channels.audit');
});


test('channels.audit uses derived token and performs no message delivery', async () => {
  const root = 'V'.repeat(40);
  const expectedToken = deriveChannelInternalToken(root);
  let called = 0;

  const result = await readChannelBridgeAudit({
    env: { VQS_API_TOKEN: root },
    fetchImpl: async (url, init) => {
      called += 1;
      assert.equal(
        String(url),
        'http://127.0.0.1:4400/api/v1/channels/capabilities?probe=false'
      );
      assert.equal(
        init.headers['X-Elankav-Internal-Token'],
        expectedToken
      );
      assert.notEqual(
        init.headers['X-Elankav-Internal-Token'],
        root
      );
      return new Response(JSON.stringify({
        scope: 'ELANKAV_GLOBAL',
        capabilities: [
          { channel: 'whatsapp', state: 'VERIFIED', configured: true },
          { channel: 'email', state: 'AUTH_REQUIRED', configured: false },
          { channel: 'messenger', state: 'AUTH_REQUIRED', configured: false },
          { channel: 'instagram_dm', state: 'AUTH_REQUIRED', configured: false }
        ]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  assert.equal(called, 1);
  assert.equal(result.bridgeState, 'VERIFIED');
  assert.equal(result.messagesSent, 0);
  assert.equal(result.secretsExposed, false);
});


test('channels.audit returns visible failure instead of throwing on CONNECT auth error', async () => {
  const result = await readChannelBridgeAudit({
    env: { VQS_API_TOKEN: 'V'.repeat(40) },
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: 'CONNECT_INTERNAL_UNAUTHORIZED',
        message: 'Credencial interna inválida.'
      }
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  });

  assert.equal(result.capability, 'channels.audit');
  assert.equal(result.bridgeState, 'FAILED');
  assert.equal(result.errorCode, 'CONNECT_INTERNAL_UNAUTHORIZED');
  assert.equal(result.messagesSent, 0);
  assert.equal(result.secretsExposed, false);
});


test('channels.audit returns visible failure instead of throwing when CONNECT is unavailable', async () => {
  const result = await readChannelBridgeAudit({
    env: { VQS_API_TOKEN: 'V'.repeat(40) },
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:4400');
    }
  });

  assert.equal(result.bridgeState, 'FAILED');
  assert.equal(result.errorCode, 'CHANNEL_BRIDGE_CONNECT_UNAVAILABLE');
  assert.equal(result.messagesSent, 0);
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
