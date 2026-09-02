'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOwnerProspectingOutreachCommand,
  executeOwnerProspectingOutreachCommand
} = require('../services/ownerProspectingOutreachCommandService');

test('continuá la prueba no reanuda una campaña pausada', () => {
  assert.equal(detectOwnerProspectingOutreachCommand('ELAN, continuá la prueba'), null);
  assert.equal(detectOwnerProspectingOutreachCommand('continuá la prueba de la plantilla para empresas'), null);
});

test('contactar a todos produce preflight y no crea campaña', async () => {
  const command = detectOwnerProspectingOutreachCommand('ELAN, contactá a todos los prospectos elegibles');
  assert.equal(command?.input?.action, 'preflight');
  const calls = [];
  const requestImpl = async (path) => {
    calls.push(path);
    if (path.endsWith('/control-status')) return { outreachEnabled: true };
    if (path.includes('/missions')) return [{ id: 'mission-1', status: 'partial', duplicatesDiscarded: 4 }];
    if (path.endsWith('/outreach-preflight')) return { totalProspects: 20, withEmail: 12, withWhatsapp: 10, usableDecisionContacts: 14, duplicateContacts: 2, blocked: 3, eligibleProspects: 11, emailRecipients: 9, whatsappRecipients: 8 };
    throw new Error('unexpected ' + path);
  };
  const result = await executeOwnerProspectingOutreachCommand(command, { requestImpl });
  assert.match(result.outputText, /no envié nada/i);
  assert.match(result.outputText, /Recibirán correo: 9/);
  assert.equal(calls.filter(path => path.endsWith('/outreach-preflight')).length, 1);
  assert.equal(calls.some(path => path.endsWith('/outreach-campaigns')), false);
});

test('una orden explícita sí puede reanudar la campaña', () => {
  assert.deepEqual(
    detectOwnerProspectingOutreachCommand('ELAN, reanudá la campaña pausada'),
    {
      type: 'business_prospecting_outreach_campaign_create',
      input: { action: 'resume', raw: 'reanudá la campaña pausada' }
    }
  );
});
