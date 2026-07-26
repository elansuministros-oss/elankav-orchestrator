'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKSPACE_OWNER_COMMANDS,
  detectWorkspaceOwnerCommand,
  extractPath,
  extractSearchQuery,
  resolveWorkspaceId
} = require('../services/ownerWorkspaceCommandService');
const { detectOwnerCommand } = require('../services/ownerCommandService');

test('detecta búsqueda global de código desde lenguaje natural', () => {
  const command = detectWorkspaceOwnerCommand('Busca quotationDocumentBuilder.');
  assert.deepEqual(command, {
    type: WORKSPACE_OWNER_COMMANDS.SEARCH,
    workspaceId: null,
    query: 'quotationDocumentBuilder'
  });
});

test('detecta búsqueda limitada a ELANVISUAL', () => {
  const command = detectWorkspaceOwnerCommand('Busca quotationDocumentBuilder en ELANVISUAL');
  assert.equal(command.type, WORKSPACE_OWNER_COMMANDS.SEARCH);
  assert.equal(command.workspaceId, 'elanvisual');
  assert.equal(command.query, 'quotationDocumentBuilder');
});

test('router owner prioriza búsqueda read-only y no crea code job', () => {
  const command = detectOwnerCommand('Busca quotationDocumentBuilder.');
  assert.equal(command.type, WORKSPACE_OWNER_COMMANDS.SEARCH);
  assert.equal(command.query, 'quotationDocumentBuilder');
});

test('detecta lectura explícita de archivo y workspace', () => {
  const command = detectWorkspaceOwnerCommand('Lee el archivo README.md de ELANVISUAL');
  assert.equal(command.type, WORKSPACE_OWNER_COMMANDS.READ);
  assert.equal(command.workspaceId, 'elanvisual');
  assert.equal(command.path, 'README.md');
});

test('detecta diff sin habilitar escritura', () => {
  const command = detectWorkspaceOwnerCommand('Muéstrame los cambios pendientes de CONNECT');
  assert.equal(command.type, WORKSPACE_OWNER_COMMANDS.DIFF);
  assert.equal(command.workspaceId, 'connect');
});

test('detecta consulta de package manifest', () => {
  const command = detectWorkspaceOwnerCommand('Muéstrame las dependencias de ELAN IA');
  assert.equal(command.type, WORKSPACE_OWNER_COMMANDS.PACKAGE);
  assert.equal(command.workspaceId, 'elan-ai');
});

test('extractores no confunden órdenes de modificación con consultas', () => {
  assert.equal(extractSearchQuery('Modifica package.json'), null);
  assert.equal(extractPath('Modifica package.json'), 'package.json');
  assert.equal(detectWorkspaceOwnerCommand('Modifica package.json'), null);
});

test('resuelve aliases principales de workspace', () => {
  assert.equal(resolveWorkspaceId('revisa ELANKAV CONNECT'), 'connect');
  assert.equal(resolveWorkspaceId('consulta ELANHOME'), 'elanhome');
  assert.equal(resolveWorkspaceId('abre Orchestrator'), 'orchestrator');
});
