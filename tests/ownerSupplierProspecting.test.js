'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectOwnerCommand,
  OWNER_COMMANDS
} = require('../services/ownerCommandService');
const {
  buildSupplierMission,
  isSupplierProspectingRequest,
  parseTargetCount,
  startSupplierProspectingMission
} = require('../services/supplierProspectingOwnerService');

test('detects natural Owner supplier search orders', () => {
  const message = 'ELAN buscá 200 proveedores para ELANVISUAL de PVC, ACM, impresión y rótulos en Nicaragua';
  assert.equal(isSupplierProspectingRequest(message), true);
  assert.equal(parseTargetCount(message), 200);
  const command = detectOwnerCommand(message);
  assert.equal(command.type, OWNER_COMMANDS.SUPPLIER_PROSPECTING_START);
  assert.equal(command.message, message);
});

test('caps supplier missions at current CONNECT mission limit', () => {
  assert.equal(parseTargetCount('busca 500 proveedores'), 500);
  assert.equal(parseTargetCount('busca 2000 proveedores'), 500);
  assert.equal(parseTargetCount('busca proveedores nuevos'), 200);
});

test('supplier mission explicitly disables contact and official promotion', () => {
  const mission = buildSupplierMission('busca proveedores de rotulación', 200);
  assert.match(mission, /\[SUPPLIER_PROSPECTING\]/);
  assert.match(mission, /No contactar a nadie/i);
  assert.match(mission, /No promover candidatos a la base oficial/i);
  assert.match(mission, /PVC/);
  assert.match(mission, /Nicaragua/);
});

test('creates continuous mission and runs first cycle with outreach untouched', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/control-status')) {
      return new Response(JSON.stringify({
        researchEnabled: true,
        autopilotEnabled: true,
        outreachEnabled: false,
        outreachAutopilotEnabled: false,
        emailOutreachEnabled: false,
        whatsappOutreachEnabled: false
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/missions') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.mode, 'continuous');
      assert.equal(body.targetCompanies, 200);
      assert.equal(body.country, 'Nicaragua');
      assert.match(body.mission, /SUPPLIER_PROSPECTING/);
      return new Response(JSON.stringify({
        id: '11111111-1111-4111-8111-111111111111',
        targetCompanies: 200,
        companiesFound: 0,
        status: 'draft'
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('/missions/11111111-1111-4111-8111-111111111111/run')) {
      return new Response(JSON.stringify({
        mission: {
          id: '11111111-1111-4111-8111-111111111111',
          targetCompanies: 200,
          companiesFound: 37,
          status: 'partial'
        },
        searchRunIds: ['run-1']
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };

  const result = await startSupplierProspectingMission({
    message: 'ELAN busca 200 proveedores para ELANVISUAL',
    fetchImpl,
    env: {
      ELANKAV_CONNECT_URL: 'https://connect.example.test',
      CONNECT_INTERNAL_API_TOKEN: 'test-token',
      CONNECT_PROSPECTING_TIMEOUT_MS: '1000'
    }
  });

  assert.equal(result.mission.companiesFound, 37);
  assert.equal(result.control.autopilotEnabled, true);
  assert.equal(result.control.outreachEnabled, false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.options.headers.Authorization === 'Bearer test-token'));
});
