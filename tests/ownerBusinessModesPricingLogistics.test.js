'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MODES,
  canUseCapability,
  getOperatorState,
  setOperatorMode
} = require('../services/operatorModeService');
const {
  resolveAuthorizedPrice
} = require('../services/pricingAuthorizationPolicyService');
const {
  DELIVERY_METHODS,
  buildLogisticsRequest,
  resolveMissingRequirements
} = require('../services/quotationRequirementResolver');
const {
  OWNER_COMMANDS,
  detectOwnerModeCommand
} = require('../services/ownerCommandService');

test('Owner can persistently change operating mode', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-mode-'));
  const env = { OPERATOR_MODE_STORE_PATH: path.join(dir, 'modes.json') };

  const initial = await getOperatorState({ operatorId: 'owner', role: 'OWNER', env });
  assert.equal(initial.activeMode, MODES.OWNER_GENERAL);

  const changed = await setOperatorMode({ operatorId: 'owner', role: 'OWNER', mode: 'jefe de produccion', env });
  assert.equal(changed.activeMode, MODES.PRODUCCION);

  const persisted = await getOperatorState({ operatorId: 'owner', role: 'OWNER', env });
  assert.equal(persisted.activeMode, MODES.PRODUCCION);
});

test('Seller profile is locked to sales mode and cannot set manual price', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-seller-'));
  const env = { OPERATOR_MODE_STORE_PATH: path.join(dir, 'modes.json') };
  const state = await getOperatorState({ operatorId: 'valentina', role: 'VENDEDOR', env });
  assert.equal(state.activeMode, MODES.VENTAS);
  assert.equal(state.canChangeMode, false);
  assert.equal(canUseCapability('VENDEDOR', 'business.quotation.create'), true);
  assert.equal(canUseCapability('VENDEDOR', 'business.payment.apply'), false);

  const result = resolveAuthorizedPrice({
    role: 'VENDEDOR',
    manualPrice: 300,
    officialPrice: 340,
    quote: { sellerId: 'valentina', product: 'rotulo', width: 1, height: 1, destination: 'Granada' },
    authorizations: []
  });
  assert.equal(result.allowed, false);
  assert.equal(result.price, 340);
  assert.equal(result.reason, 'SELLER_MANUAL_PRICE_NOT_ALLOWED');
});

test('Owner price authorization enables exact matching seller quote', () => {
  const result = resolveAuthorizedPrice({
    role: 'VENDEDOR',
    manualPrice: null,
    officialPrice: 340,
    quote: { sellerId: 'valentina', product: 'rotulo', width: 1, height: 1, quantity: 1, destination: 'Granada' },
    authorizations: [{
      id: 'PA-001',
      status: 'ACTIVE',
      sellerId: 'valentina',
      product: 'rotulo',
      width: 1,
      height: 1,
      quantity: 1,
      destination: 'Granada',
      price: 300
    }]
  });
  assert.equal(result.allowed, true);
  assert.equal(result.price, 300);
  assert.equal(result.source, 'OWNER_PRICE_AUTHORIZATION');
  assert.equal(result.authorizationId, 'PA-001');
});

test('Installation quote requires location before logistics can be calculated', () => {
  const requirements = resolveMissingRequirements({
    text: 'lona banner impresion UV 2x1 instalada',
    width: 2,
    height: 1,
    quantity: 1
  });
  assert.equal(requirements.deliveryMethod, DELIVERY_METHODS.INSTALLATION);
  assert.deepEqual(requirements.missing, ['location']);

  const request = buildLogisticsRequest({
    text: 'lona banner impresion UV 2x1 instalada',
    width: 2,
    height: 1,
    quantity: 1
  });
  assert.equal(request.ready, false);
  assert.match(request.question, /Dónde se realizará la instalación/);
});

test('Delivery and carrier are separate logistics modes', () => {
  const delivery = buildLogisticsRequest({
    text: 'lona 2x1 con delivery',
    width: 2,
    height: 1,
    quantity: 1,
    deliveryAddress: 'Managua, Nicaragua'
  });
  assert.equal(delivery.ready, true);
  assert.equal(delivery.logistics.method, DELIVERY_METHODS.DELIVERY);
  assert.equal(delivery.logistics.requiresRoadDistance, true);

  const carrier = buildLogisticsRequest({
    text: 'enviar por Cargo Trans a Esteli',
    width: 2,
    height: 1,
    quantity: 1,
    destination: 'Esteli, Nicaragua',
    carrier: 'Cargo Trans'
  });
  assert.equal(carrier.ready, true);
  assert.equal(carrier.logistics.method, DELIVERY_METHODS.CARRIER);
  assert.equal(carrier.logistics.requiresCarrierRate, true);
});

test('Owner mode natural language commands are detected', () => {
  const set = detectOwnerModeCommand('Actúa como jefe de producción');
  assert.equal(set.type, OWNER_COMMANDS.MODE_SET);
  assert.equal(set.mode, MODES.PRODUCCION);

  const get = detectOwnerModeCommand('¿En qué modo estás?');
  assert.equal(get.type, OWNER_COMMANDS.MODE_GET);
});
