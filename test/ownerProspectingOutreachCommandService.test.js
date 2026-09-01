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
        ownerAuthorizationRequired: true,
        outreachAutopilotEnabled: true,
        emailOutreachEnabled: true,
        whatsappOutreachEnabled: true
      };
    }
    if (path.startsWith('/api/v1/prospecting/missions?')) return [mission];
    if (path === '/api/v1/prospecting/outreach-campaigns') return campaign;
    if (path.endsWith('/prepare')) return { ...campaign, status: 'draft', queuedCount: 1 };
    if (path.endsWith('/activate')) return { ...campaign, status: 'active' };
    throw new Error('Unexpected request ' + path);
  };

  const result = await executeOwnerProspectingOutreachCommand(
    detectOwnerProspectingOutreachCommand(EXACT),
    { requestImpl }
  );

  assert.equal(result.handled, true);
  assert.equal(result.result.campaign.status, 'active');
  assert.equal(calls.length, 5);
  assert.equal(calls[2].options.body.strategy, 'email_first');
  assert.equal(calls[2].options.body.maxTargets, 500);
  assert.equal(calls[2].options.body.requireDecisionMaker, true);
  assert.equal(calls[3].path, '/api/v1/prospecting/outreach-campaigns/' + campaign.id + '/prepare');
  assert.equal(calls[4].path, '/api/v1/prospecting/outreach-campaigns/' + campaign.id + '/activate');
  assert.match(result.outputText, /Ya empecé/);
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
        ownerAuthorizationRequired: true,
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


test('entiende órdenes cortas y naturales de inicio sin exigir la palabra misión', () => {
  const email = detectOwnerProspectingOutreachCommand(
    'ELAN, empezá a enviar correos a las empresas que ya estén listas, solo 20 hoy'
  );
  assert.ok(email);
  assert.equal(email.input.action, 'start');
  assert.equal(email.input.strategy, 'email_only');
  assert.equal(email.input.maxTargets, 20);

  const whatsapp = detectOwnerProspectingOutreachCommand(
    'mandales wasap a las empresas que tengan número verificado'
  );
  assert.ok(whatsapp);
  assert.equal(whatsapp.input.action, 'start');
  assert.equal(whatsapp.input.strategy, 'whatsapp_only');

  const both = detectOwnerProspectingOutreachCommand(
    'comenzá a enviar correos y mensajes a las empresas listas'
  );
  assert.ok(both);
  assert.equal(both.input.strategy, 'email_first');
});

test('no secuestra órdenes de clientes, cotizaciones o proveedores', () => {
  assert.equal(
    detectOwnerProspectingOutreachCommand('enviale correo al cliente Juan con la cotización'),
    null
  );
  assert.equal(
    detectOwnerProspectingOutreachCommand('manda whatsapp al proveedor Vargas'),
    null
  );
});

test('pausa campañas activas con lenguaje natural', async () => {
  const command = detectOwnerProspectingOutreachCommand('ELAN pausa los mensajes');
  assert.ok(command);
  assert.equal(command.input.action, 'pause');

  const calls = [];
  const result = await executeOwnerProspectingOutreachCommand(command, {
    requestImpl: async (path, options = {}) => {
      calls.push({ path, options });
      if (path.includes('status=active')) {
        return [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'active' },
          { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'active' }
        ];
      }
      if (path.endsWith('/pause')) return { id: path.split('/').at(-2), status: 'paused' };
      throw new Error('Unexpected request ' + path);
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.result.campaigns.length, 2);
  assert.equal(calls.filter(x => x.path.endsWith('/pause')).length, 2);
  assert.match(result.outputText, /Pausé 2 campaña/);
});

test('reanuda la campaña pausada respetando sus canales', async () => {
  const command = detectOwnerProspectingOutreachCommand('ELAN seguí con los correos');
  assert.ok(command);
  assert.equal(command.input.action, 'resume');

  const paused = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'paused',
    strategy: 'email_only'
  };

  const result = await executeOwnerProspectingOutreachCommand(command, {
    requestImpl: async (path) => {
      if (path === '/api/v1/prospecting/control-status') {
        return {
          outreachEnabled: true,
        ownerAuthorizationRequired: true,
          outreachAutopilotEnabled: true,
          emailOutreachEnabled: true,
          whatsappOutreachEnabled: false
        };
      }
      if (path.includes('status=paused')) return [paused];
      if (path.endsWith('/activate')) return { ...paused, status: 'active' };
      throw new Error('Unexpected request ' + path);
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.result.campaign.status, 'active');
  assert.match(result.outputText, /Reanudé/);
});

test('una orden explícita de correo no exige WhatsApp habilitado', async () => {
  const command = detectOwnerProspectingOutreachCommand(
    'ELAN empezá a enviar correos a las empresas listas, solo 5 hoy'
  );
  const mission = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    targetCompanies: 500,
    status: 'running'
  };
  const campaign = {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    missionId: mission.id,
    maxTargets: 5,
    strategy: 'email_only',
    minPriority: 'MEDIA PRIORIDAD',
    status: 'draft'
  };

  const result = await executeOwnerProspectingOutreachCommand(command, {
    requestImpl: async (path) => {
      if (path === '/api/v1/prospecting/control-status') {
        return {
          outreachEnabled: true,
        ownerAuthorizationRequired: true,
          outreachAutopilotEnabled: true,
          emailOutreachEnabled: true,
          whatsappOutreachEnabled: false
        };
      }
      if (path.startsWith('/api/v1/prospecting/missions?')) return [mission];
      if (path === '/api/v1/prospecting/outreach-campaigns') return campaign;
      if (path.endsWith('/prepare')) return { ...campaign, queuedCount: 5 };
      if (path.endsWith('/activate')) return { ...campaign, status: 'active' };
      throw new Error('Unexpected request ' + path);
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.result.campaign.strategy, 'email_only');
  assert.equal(result.result.campaign.maxTargets, 5);
  assert.match(result.outputText, /como máximo 5 empresas/);
});
