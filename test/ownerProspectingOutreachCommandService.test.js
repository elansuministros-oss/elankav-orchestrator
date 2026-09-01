'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMAND_TYPE,
  detectOwnerProspectingOutreachCommand,
  executeOwnerProspectingOutreachCommand
} = require('../services/ownerProspectingOutreachCommandService');
const {
  detectOwnerBusinessCommand
} = require('../services/ownerBusinessProcessMessageGateway');

const EXACT =
  'Contactar las empresas encontradas en la misión de 500 prospectos de ELANVISUAL. Priorizar decisores de Mercadeo y Compras. Enviar primero por correo cuando exista email público validado y usar WhatsApp cuando exista número empresarial público validado.';

test('detecta la orden natural de Outreach Autopilot', () => {
  const command = detectOwnerProspectingOutreachCommand(EXACT);
  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);
  assert.equal(command.input.missionTarget, 500);
  assert.equal(command.input.strategy, 'email_first');
  assert.equal(command.input.minPriority, 'MEDIA PRIORIDAD');
  assert.equal(command.input.requireDecisionMaker, true);
});

test('Owner Business Gateway prioriza Outreach sobre búsqueda Prospecting', () => {
  const command = detectOwnerBusinessCommand(EXACT);
  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);
});

test('crea y activa campaña contra la misión de 500 cuando todos los switches están ON', async () => {
  const calls = [];
  const mission = {
    id: '11111111-1111-4111-8111-111111111111',
    targetCompanies: 500,
    status: 'completed'
  };
  const campaign = {
    id: '22222222-2222-4222-8222-222222222222',
    missionId: mission.id,
    maxTargets: 500,
    strategy: 'email_first',
    minPriority: 'MEDIA PRIORIDAD',
    status: 'draft'
  };

  const requestImpl = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/api/v1/prospecting/control-status') {
      return {
        researchEnabled: true,
        autopilotEnabled: true,
        outreachEnabled: true,
        outreachAutopilotEnabled: true,
        emailOutreachEnabled: true,
        whatsappOutreachEnabled: true
      };
    }
    if (path.startsWith('/api/v1/prospecting/missions?')) return [mission];
    if (path === '/api/v1/prospecting/outreach-campaigns') return campaign;
    if (path.endsWith('/activate')) return { ...campaign, status: 'active' };
    throw new Error('Unexpected request ' + path);
  };

  const result = await executeOwnerProspectingOutreachCommand(
    detectOwnerProspectingOutreachCommand(EXACT),
    { requestImpl }
  );

  assert.equal(result.handled, true);
  assert.equal(result.result.campaign.status, 'active');
  assert.equal(calls.length, 4);
  assert.equal(calls[2].options.body.strategy, 'email_first');
  assert.equal(calls[2].options.body.maxTargets, 500);
  assert.equal(calls[2].options.body.requireDecisionMaker, true);
  assert.equal(calls[3].path, '/api/v1/prospecting/outreach-campaigns/' + campaign.id + '/activate');
  assert.match(result.outputText, /Outreach Autopilot activado/);
  assert.match(result.outputText, /Email: ON/);
  assert.match(result.outputText, /WhatsApp: ON/);
});

test('no crea campaña si WhatsApp Outreach está OFF para estrategia email_first', async () => {
  let calls = 0;
  await assert.rejects(
    () => executeOwnerProspectingOutreachCommand(
      detectOwnerProspectingOutreachCommand(EXACT),
      {
        requestImpl: async () => {
          calls += 1;
          return {
            outreachEnabled: true,
            outreachAutopilotEnabled: true,
            emailOutreachEnabled: true,
            whatsappOutreachEnabled: false
          };
        }
      }
    ),
    error => error && error.code === 'PROSPECTING_WHATSAPP_OUTREACH_DISABLED'
  );
  assert.equal(calls, 1);
});

test('solo correo no exige WhatsApp habilitado', async () => {
  const command = detectOwnerProspectingOutreachCommand(
    'Contactar las empresas de la misión de 500 prospectos. Solo correo.'
  );
  assert.ok(command);
  assert.equal(command.input.strategy, 'email_only');
});
