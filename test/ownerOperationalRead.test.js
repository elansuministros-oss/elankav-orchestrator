'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OWNER_COMMANDS,
  detectOwnerCommand
} = require('../services/ownerCommandService');
const {
  formatCapabilityCatalog,
  formatRecentJobs,
  formatWahaStatus
} = require('../services/ownerOperationalReadService');

test('detecta catálogo Owner sin crear Job', () => {
  const command = detectOwnerCommand('Listá las capacidades y acciones registradas del Owner Router. No crear Job.');
  assert.equal(command.type, OWNER_COMMANDS.CAPABILITY_CATALOG);
});

test('detecta lista de Jobs como consulta directa', () => {
  const command = detectOwnerCommand('Mostrá los últimos 3 Jobs registrados');
  assert.equal(command.type, OWNER_COMMANDS.JOBS_LIST);
});

test('detecta estado WAHA como consulta directa', () => {
  const command = detectOwnerCommand('Consultá el estado de la sesión WAHA ELANKAV');
  assert.equal(command.type, OWNER_COMMANDS.WAHA_STATUS);
});

test('una auditoría READ ONLY no se convierte en CODE_JOB', () => {
  const command = detectOwnerCommand('Auditá elan-ai en modo READ ONLY. No crear Job. No usar Codex.');
  assert.notEqual(command?.type, OWNER_COMMANDS.CODE_JOB);
});

test('mantiene órdenes de programación explícitas', () => {
  const command = detectOwnerCommand('Implementá una corrección en elan-ai');
  assert.equal(command.type, OWNER_COMMANDS.CODE_JOB);
  assert.equal(command.platform, 'elan-ai');
});

test('formatea respuestas verificables', () => {
  assert.match(formatCapabilityCatalog(), /owner\.jobs\.list/);
  assert.match(formatRecentJobs([{ id: 'JOB-1-a', status: 'failed' }]), /JOB-1-a/);
  assert.match(formatWahaStatus({
    session: 'ELANKAV',
    status: 'WORKING',
    engine: 'WEBJS',
    me: { id: '50578828089@c.us' },
    webhooks: [],
    checkedAt: '2026-07-24T00:00:00.000Z'
  }), /5057882\*\*\*\*/);
});
