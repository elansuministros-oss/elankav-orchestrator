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

const CONTROL_ON = {
  researchEnabled: true,
  autopilotEnabled: true,
  outreachEnabled: true,
  outreachAutopilotEnabled: true,
  emailOutreachEnabled: true,
  whatsappOutreachEnabled: true
};

test('detecta la orden de Outreach existente', () => {
  const command = detectOwnerProspectingOutreachCommand(EXACT);
  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);
  assert.equal(command.input.action, 'start');
  assert.equal(command.input.missionTarget, 500);
  assert.equal(command.input.strategy, 'email_first');
  assert.equal(command.input.minPriority, 'MEDIA PRIORIDAD');
  assert.equal(command.input.requireDecisionMaker, true);
});

test('entiende órdenes cotidianas para correo, WhatsApp, ambos, cantidad y pausa', () => {
  const cases = [
    ['ELAN comienza a enviar correos a las empresas que ya estan listas', 'start', 'email_only', null],
    ['manda wasap a las empresas encontradas', 'start', 'whatsapp_only', null],
    ['empeza a mandar correos y whatsapp a las empresas listas', 'start', 'email_first', null],
    ['contacta 20 empresas hoy por correo', 'start', 'email_only', 20],
    ['reanuda los mensajes a las empresas de la investigacion', 'resume', 'whatsapp_only', null],
    ['pausa los mensajes a las empresas', 'pause', undefined, null],
    ['deten la campaña de correos', 'pause', undefined, null]
  ];

  for (const [message, action, strategy, maxTargets] of cases) {
    const command = detectOwnerProspectingOutreachCommand(message);
    assert.ok(command, message);
    assert.equal(command.type, COMMAND_TYPE, message);
    assert.equal(command.input.action, action, message);
    if (strategy) assert.equal(command.input.strategy, strategy, message);
    if (maxTargets) assert.equal(command.input.maxTargets, maxTargets, message);
  }
});

test('no secuestra instrucciones de correo sin alcance comercial Prospecting', () => {
  assert.equal(
    detectOwnerProspectingOutreachCommand('manda este correo a Carlos'),
    null
  );
  assert.equal(
    detectOwnerProspectingOutreachCommand('escribe un mensaje para el cliente'),
    null
  );
});

test('Owner Business Gateway prioriza Outreach sobre búsqueda Prospecting', () => {
  const command = detectOwnerBusinessCommand(EXACT);
  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);
});

test('crea y activa campaña contra la misión activa cuando todos los switches están ON', async () => {
  const calls = [];
  const mission = {
    id: '11111111-1111-4111-8111-111111111111',
    targetCompanies: 500,
    status: 'running'
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
    if (path === '/api/v1/prospecting/control-status') return CONTROL_ON;
    if (path.startsWith('/api/v1/prospecting/missions?')) return [mission];
    if (path === '/api/v1/prospecting/outreach-campaigns') return campaign;
    if (path.endsWith('/activate')) return { ...campaign, status: 'active' };
    throw new Error('Unexpected request ' + path);
  };

  const command = detectOwnerProspectingOutreachCommand(
    'ELAN comienza a enviar correos y WhatsApp a las empresas que ya estan listas'
  );
  const result = await executeOwnerProspectingOutreachCommand(command, { requestImpl });

  assert.equal(result.handled, true);
  assert.equal(result.result.campaign.status, 'active');
  assert.equal(calls.length, 4);
  assert.equal(calls[2].options.body.strategy, 'email_first');
  assert.equal(calls[2].options.body.maxTargets, 500);
  assert.equal(calls[2].options.body.requireDecisionMaker, true);
  assert.equal(calls[3].path, '/api/v1/prospecting/outreach-campaigns/' + campaign.id + '/activate');
  assert.match(result.outputText, /Ya dejé activa la campaña comercial/);
  assert.match(result.outputText, /decisores verificados/);
  assert.match(result.outputText, /horario comercial/);
});

test('pausa campañas activas sin exigir que Outreach esté ON', async () => {
  const calls = [];
  const requestImpl = async (path, options = {}) => {
    calls.push({ path, options });
    if (path.includes('status=active')) {
      return [
        { id: '11111111-1111-4111-8111-111111111111', status: 'active' },
        { id: '22222222-2222-4222-8222-222222222222', status: 'active' }
      ];
    }
    if (path.endsWith('/pause')) return { status: 'paused' };
    throw new Error('Unexpected request ' + path);
  };

  const command = detectOwnerProspectingOutreachCommand('ELAN pausa los mensajes a las empresas');
  const result = await executeOwnerProspectingOutreachCommand(command, { requestImpl });

  assert.equal(result.handled, true);
  assert.equal(result.result.paused.length, 2);
  assert.equal(calls.length, 3);
  assert.match(result.outputText, /Pausé 2 campaña/);
});

test('no crea campaña si WhatsApp está OFF para estrategia de ambos canales', async () => {
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

test('solo correo no exige WhatsApp habilitado', () => {
  const command = detectOwnerProspectingOutreachCommand(
    'Contactar las empresas de la misión de 500 prospectos. Solo correo.'
  );
  assert.ok(command);
  assert.equal(command.input.strategy, 'email_only');
});
