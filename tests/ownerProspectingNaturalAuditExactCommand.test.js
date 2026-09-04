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

  const requestedPaths = [];

  const result = await executeOwnerProspectingNaturalAudit(command, {
    requestImpl: async (path, options) => {
      requestedPaths.push(path);
      assert.equal(options.method, 'GET');

      if (path === '/api/v1/prospecting/audit') {
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

      if (path === '/api/v1/prospecting/outreach-deliveries?status=sent&limit=10') {
        return [];
      }

      throw new Error(`UNEXPECTED_PATH:${path}`);
    }
  });

  assert.deepEqual(requestedPaths, [
    '/api/v1/prospecting/audit',
    '/api/v1/prospecting/outreach-deliveries?status=sent&limit=10'
  ]);
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


test('includes real outbound delivery evidence in Owner audit', async () => {
  const command = detectOwnerProspectingNaturalAudit(
    'ELAN, dame la auditoría de prospecting de hoy para ELANVISUAL'
  );

  assert.ok(command);

  const requestedPaths = [];

  const result = await executeOwnerProspectingNaturalAudit(command, {
    requestImpl: async (path, options) => {
      requestedPaths.push(path);
      assert.equal(options.method, 'GET');

      if (path === '/api/v1/prospecting/audit') {
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

      if (path === '/api/v1/prospecting/outreach-deliveries?status=sent&limit=10') {
        return [
          {
            channel: 'whatsapp',
            destination: '50583638510',
            status: 'sent',
            attemptCount: 1,
            externalRef: 'waha-message-ref',
            sentAt: '2026-09-04T01:47:02.261Z'
          },
          {
            channel: 'email',
            destination: 'disproquimnicaragua@gmail.com',
            status: 'sent',
            attemptCount: 1,
            externalRef: 'gmail-provider-ref',
            sentAt: '2026-09-04T01:39:00.323Z'
          }
        ];
      }

      throw new Error(`UNEXPECTED_PATH:${path}`);
    }
  });

  assert.deepEqual(requestedPaths, [
    '/api/v1/prospecting/audit',
    '/api/v1/prospecting/outreach-deliveries?status=sent&limit=10'
  ]);

  assert.equal(result.handled, true);
  assert.match(result.outputText, /Evidencia reciente de envíos/);
  assert.match(result.outputText, /50583638510/);
  assert.match(result.outputText, /disproquimnicaragua@gmail\.com/);
  assert.match(result.outputText, /waha-message-ref/);
  assert.match(result.outputText, /gmail-provider-ref/);
});
