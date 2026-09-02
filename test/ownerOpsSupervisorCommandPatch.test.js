'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectSupervisorCommand,
  formatSupervisorStatus,
  STATUS_TYPE
} = require('../services/ownerOpsSupervisorCommandPatch');

test('routes Orchestrator self restart through confirmed supervisor operation', () => {
  const command = detectSupervisorCommand('ELAN reinicia Orchestrator');
  assert.equal(command.capability, 'service.restart');
  assert.equal(command.target, 'orchestrator');
  assert.match(command.impact, /supervisor externo/i);
});

test('routes exact commit deploy only when target and full sha are present', () => {
  const sha = '1234567890abcdef1234567890abcdef12345678';
  const command = detectSupervisorCommand(`ELAN despliega Orchestrator commit ${sha}`);
  assert.equal(command.capability, 'repository.deploy');
  assert.equal(command.target, 'orchestrator');
  assert.equal(command.parameters.expectedCommit, sha);
  assert.equal(command.parameters.restart, true);
});

test('CONNECT deploy declares controlled install build and port verification', () => {
  const sha = 'abcdef1234567890abcdef1234567890abcdef12';
  const command = detectSupervisorCommand(`ELAN despliega CONNECT commit ${sha}`);
  assert.equal(command.capability, 'repository.deploy');
  assert.equal(command.target, 'connect');
  assert.equal(command.parameters.install, true);
  assert.match(command.impact, /npm ci/i);
  assert.match(command.impact, /build TypeScript/i);
  assert.match(command.impact, /puerto 4400/i);
});

test('formats verified CONNECT deployment details for WhatsApp', () => {
  const text = formatSupervisorStatus({
    id: 'OPS-1234567890-ABC123',
    status: 'completed',
    execution: {
      capability: 'repository.deploy',
      target: 'connect',
      after: 'abcdef1234567890abcdef1234567890abcdef12',
      installCommand: 'npm ci --include=dev',
      buildCommand: 'npm run build',
      service: 'elankav-connect.service',
      status: 'active',
      listening: '127.0.0.1:4400'
    }
  });
  assert.match(text, /npm ci --include=dev/);
  assert.match(text, /npm run build/);
  assert.match(text, /127\.0\.0\.1:4400/);
});

test('Langflow deploy stays isolated and uses supervisor repository.deploy', () => {
  const sha = 'fedcba0987654321fedcba0987654321fedcba09';
  const command = detectSupervisorCommand(`ELAN despliega Langflow commit ${sha}`);
  assert.equal(command.capability, 'repository.deploy');
  assert.equal(command.target, 'langflow');
  assert.equal(command.parameters.expectedCommit, sha);
  assert.equal(command.parameters.install, false);
  assert.equal(command.parameters.restart, true);
  assert.match(command.impact, /127\.0\.0\.1:7860/);
  assert.match(command.impact, /No reinicia Orchestrator/i);
});

test('formats verified Langflow health separately from Orchestrator health', () => {
  const text = formatSupervisorStatus({
    id: 'OPS-1234567890-ABC123',
    status: 'completed',
    execution: {
      capability: 'repository.deploy',
      target: 'langflow',
      after: 'fedcba0987654321fedcba0987654321fedcba09',
      service: 'docker:elankav-langflow',
      status: 'active',
      listening: '127.0.0.1:7860',
      healthEndpoint: 'http://127.0.0.1:7860/health_check'
    }
  });
  assert.match(text, /Langflow health: OK/);
  assert.match(text, /127\.0\.0\.1:7860/);
  assert.doesNotMatch(text, /Orchestrator health: OK/);
});

test('does not accept deploy without exact 40 character commit', () => {
  assert.equal(detectSupervisorCommand('ELAN despliega Orchestrator commit abc1234'), null);
});

test('routes supervisor operation status query', () => {
  const command = detectSupervisorCommand('ELAN estado OPS-1234567890-ABC123');
  assert.equal(command.type, STATUS_TYPE);
  assert.equal(command.operationId, 'OPS-1234567890-ABC123');
});
