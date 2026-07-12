'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OWNER_COMMANDS,
  detectOwnerCommand,
  executeOwnerCommand,
  resolvePlatformFromMessage
} = require('../services/ownerCommandService');

test('PROG-001A detecta orden de corrección para ELAN AI', () => {
  const command = detectOwnerCommand(
    'Audita ELAN IA, corrige el problema y abre un PR'
  );

  assert.equal(command.type, OWNER_COMMANDS.CODE_JOB);
  assert.equal(command.platform, 'elan-ai');
  assert.match(command.task, /corrige el problema/i);
});

test('PROG-001A resuelve plataformas configuradas', () => {
  assert.equal(
    resolvePlatformFromMessage('revisar elanvisual'),
    'elanvisual'
  );
  assert.equal(
    resolvePlatformFromMessage('programar elankav core'),
    'elankav-core'
  );
  assert.equal(
    resolvePlatformFromMessage('corregir elan pet'),
    'elanpet'
  );
});

test('PROG-001A no activa programación sin plataforma explícita', () => {
  assert.equal(
    detectOwnerCommand('Audita esto y corregilo'),
    null
  );
});

test('PROG-001A no activa programación por conversación normal', () => {
  assert.equal(
    detectOwnerCommand('Solo te estaba explicando cómo funciona ELAN IA'),
    null
  );
});

test('PROG-001A prioriza cancelación owner', async () => {
  const command = detectOwnerCommand('Cancelar esta conversación');
  const result = await executeOwnerCommand({ command });

  assert.equal(command, OWNER_COMMANDS.CANCEL_FLOW);
  assert.equal(result.job, null);
  assert.match(result.outputText, /cancelé el proceso activo/i);
});

test('PROG-001A conserva comando de sincronización', () => {
  assert.equal(
    detectOwnerCommand('Sincronizar contexto'),
    OWNER_COMMANDS.CONTEXT_SYNC
  );
});
