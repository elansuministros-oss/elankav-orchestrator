'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectOwnerProspectingNaturalAudit,
  executeOwnerProspectingNaturalAudit
} = require('../services/ownerProspectingNaturalAuditService');

test('routes exact Owner WhatsApp audit phrase to real Prospecting audit', async () => {
  const command = detectOwnerProspectingNaturalAudit(
    'ELAN, dame la auditoría de prospecting de hoy para ELANVISUAL'
  );

  assert.ok(command);
  assert.equal(command.type, 'business_prospecting_natural_audit');
  assert.equal(command.input.intent, 'overview');

  let requestedPath = null;
  const result = await executeOwnerProspectingNaturalAudit(command, {
    requestImpl: async (path, options) => {
      requestedPath = path;
      assert.equal(options.method, 'GET');
      return {
        mission: {
          status: 'running',
          targetCompanies: 10,
          companiesFound: 4,
          contactsFound: 4,
          decisionMakersFound: 2,
          readyForContact: 2,
          companiesWithoutDecision: 2
        },
        outreach: {
          emailsSent: 2,
          whatsappSent: 1,
          responses: 1,
          pendingFollowups: 0,
          negativeSignals: 0
        },
        attribution: { externalInboundAttributionComplete: true }
      };
    }
  });

  assert.equal(requestedPath, '/api/v1/prospecting/audit');
  assert.equal(result.handled, true);
  assert.match(result.outputText, /2 correo\(s\)/);
  assert.match(result.outputText, /1 WhatsApp/);
  assert.match(result.outputText, /1 respuesta\(s\)/);
});

test('does not steal unrelated generic platform status questions', () => {
  const command = detectOwnerProspectingNaturalAudit(
    'ELAN, dame el estado general de ELANVISUAL'
  );
  assert.equal(command, null);
});
