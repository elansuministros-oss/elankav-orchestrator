'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const {
  COMMAND_TYPE,
  detectOwnerProspectingCommand,
  executeOwnerProspectingCommand,
  resolveInternalToken
} = require('../services/ownerProspectingCommandService');
const {
  detectOwnerBusinessCommand
} = require('../services/ownerBusinessProcessMessageGateway');

const EXACT_COMMAND =
  'Buscar 500 empresas con presencia física en Nicaragua que puedan requerir servicios de ELANVISUAL, priorizando hoteles, restaurantes, comercios, clínicas, universidades, bancos, constructoras y centros comerciales. Localizar prioritariamente decisores públicos de Mercadeo o Compras.';

test('detecta la orden natural exacta de 500 empresas como Prospecting Autopilot', () => {
  const command = detectOwnerProspectingCommand(EXACT_COMMAND);

  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);
  assert.equal(command.input.businessUnit, 'ELANVISUAL');
  assert.equal(command.input.mode, 'continuous');
  assert.equal(command.input.country, 'Nicaragua');
  assert.equal(command.input.targetCompanies, 500);
  assert.equal(command.input.mission, EXACT_COMMAND);
});

test('Owner Business Gateway enruta la orden de Prospecting antes del modelo generativo', () => {
  const command = detectOwnerBusinessCommand(EXACT_COMMAND);
  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);
  assert.equal(command.input.targetCompanies, 500);
});

test('no secuestra búsquedas comerciales singulares ni órdenes sin cantidad', () => {
  assert.equal(detectOwnerProspectingCommand('Busca el cliente COMEX'), null);
  assert.equal(detectOwnerProspectingCommand('Busca proveedor Vargas Centro'), null);
  assert.equal(detectOwnerProspectingCommand('Busca empresas de Managua'), null);
});

test('deriva el token interno de CONNECT sin exponer VQS raw', () => {
  const env = { VQS_API_TOKEN: 'x'.repeat(64) };
  const expected = createHmac('sha256', env.VQS_API_TOKEN)
    .update('ELANKAV_CHANNEL_INTERNAL_V1')
    .digest('hex');

  assert.equal(resolveInternalToken(env), expected);
  assert.notEqual(resolveInternalToken(env), env.VQS_API_TOKEN);
});

test('crea una misión continuous solo después de validar Research y Autopilot', async () => {
  const calls = [];
  const requestImpl = async (path, options = {}) => {
    calls.push({ path, options });

    if (path === '/api/v1/prospecting/control-status') {
      return {
        researchEnabled: true,
        autopilotEnabled: true,
        outreachEnabled: false,
        mode: 'research_only'
      };
    }

    if (path.startsWith('/api/v1/prospecting/missions?')) return [];

    if (path === '/api/v1/prospecting/missions' && options.method === 'POST') {
      return {
        id: '11111111-1111-4111-8111-111111111111',
        businessUnit: 'ELANVISUAL',
        mission: EXACT_COMMAND,
        mode: 'continuous',
        country: 'Nicaragua',
        targetCompanies: 500,
        status: 'draft'
      };
    }

    throw new Error('Unexpected request: ' + path);
  };

  const command = detectOwnerProspectingCommand(EXACT_COMMAND);
  const result = await executeOwnerProspectingCommand(command, { requestImpl });

  assert.equal(result.handled, true);
  assert.equal(result.result.reused, false);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].path, '/api/v1/prospecting/control-status');
  assert.match(calls[1].path, /^\/api\/v1\/prospecting\/missions\?/);
  assert.equal(calls[2].path, '/api/v1/prospecting/missions');
  assert.deepEqual(calls[2].options.body, {
    businessUnit: 'ELANVISUAL',
    mission: EXACT_COMMAND,
    mode: 'continuous',
    country: 'Nicaragua',
    targetCompanies: 500
  });
  assert.match(result.outputText, /Misión Prospecting Autopilot creada/);
  assert.match(result.outputText, /Objetivo: 500 empresas/);
  assert.match(result.outputText, /Outreach: OFF/);
  assert.match(result.outputText, /No necesitás ejecutar la búsqueda empresa por empresa/);
});

test('reutiliza una misión activa idéntica para no duplicar 500 búsquedas', async () => {
  let postCalls = 0;
  const command = detectOwnerProspectingCommand(EXACT_COMMAND);
  const existingMission = {
    id: '22222222-2222-4222-8222-222222222222',
    businessUnit: 'ELANVISUAL',
    mission: EXACT_COMMAND,
    mode: 'continuous',
    country: 'Nicaragua',
    targetCompanies: 500,
    status: 'partial'
  };

  const requestImpl = async (path, options = {}) => {
    if (path === '/api/v1/prospecting/control-status') {
      return { researchEnabled: true, autopilotEnabled: true, outreachEnabled: false };
    }
    if (path.startsWith('/api/v1/prospecting/missions?')) return [existingMission];
    if (path === '/api/v1/prospecting/missions' && options.method === 'POST') {
      postCalls += 1;
      throw new Error('No debe crear duplicado');
    }
    throw new Error('Unexpected request: ' + path);
  };

  const result = await executeOwnerProspectingCommand(command, { requestImpl });

  assert.equal(result.handled, true);
  assert.equal(result.result.reused, true);
  assert.equal(result.result.mission.id, existingMission.id);
  assert.equal(postCalls, 0);
  assert.match(result.outputText, /no creé un duplicado/);
});

test('no crea misión si Autopilot está apagado', async () => {
  const command = detectOwnerProspectingCommand(EXACT_COMMAND);

  await assert.rejects(
    () => executeOwnerProspectingCommand(command, {
      requestImpl: async () => ({
        researchEnabled: true,
        autopilotEnabled: false,
        outreachEnabled: false
      })
    }),
    error => error && error.code === 'PROSPECTING_AUTOPILOT_DISABLED'
  );
});
