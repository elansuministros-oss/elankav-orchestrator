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
const { resolveAuthorizedPrice } = require('../services/pricingAuthorizationPolicyService');
const {
  DELIVERY_METHODS,
  buildLogisticsRequest,
  resolveMissingRequirements
} = require('../services/quotationRequirementResolver');
const { OWNER_COMMANDS, detectOwnerCommand, detectOwnerModeCommand } = require('../services/ownerCommandService');
const {
  BUSINESS_COMMANDS,
  parseCustomerCreate,
  parsePriceAuthorization
} = require('../services/ownerBusinessCommandService');
const { readContext, updateContext } = require('../services/ownerBusinessContextService');

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
      id: 'PA-001', status: 'ACTIVE', sellerId: 'valentina', product: 'rotulo', width: 1, height: 1, quantity: 1, destination: 'Granada', price: 300
    }]
  });
  assert.equal(result.allowed, true);
  assert.equal(result.price, 300);
  assert.equal(result.source, 'OWNER_PRICE_AUTHORIZATION');
  assert.equal(result.authorizationId, 'PA-001');
});

test('Installation quote requires location before logistics can be calculated', () => {
  const requirements = resolveMissingRequirements({ text: 'lona banner impresion UV 2x1 instalada', width: 2, height: 1, quantity: 1 });
  assert.equal(requirements.deliveryMethod, DELIVERY_METHODS.INSTALLATION);
  assert.deepEqual(requirements.missing, ['location']);
  const request = buildLogisticsRequest({ text: 'lona banner impresion UV 2x1 instalada', width: 2, height: 1, quantity: 1 });
  assert.equal(request.ready, false);
  assert.match(request.question, /Dónde se realizará la instalación/);
});

test('Delivery and carrier are separate logistics modes', () => {
  const delivery = buildLogisticsRequest({ text: 'lona 2x1 con delivery', width: 2, height: 1, quantity: 1, deliveryAddress: 'Managua, Nicaragua' });
  assert.equal(delivery.ready, true);
  assert.equal(delivery.logistics.method, DELIVERY_METHODS.DELIVERY);
  assert.equal(delivery.logistics.requiresRoadDistance, true);
  const carrier = buildLogisticsRequest({ text: 'enviar por Cargo Trans a Esteli', width: 2, height: 1, quantity: 1, destination: 'Esteli, Nicaragua', carrier: 'Cargo Trans' });
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

test('Owner customer creation block is parsed as an official business transaction', () => {
  const message = 'ELAN agrega este cliente:\nNombre: Carlos Perez\nEmpresa: Carlos Publicidad\nWhatsApp: +505 8888 0000\nDirección: Granada, Nicaragua';
  const parsed = parseCustomerCreate(message);
  assert.equal(parsed.type, BUSINESS_COMMANDS.CUSTOMER_CREATE);
  assert.equal(parsed.input.name, 'Carlos Perez');
  assert.equal(parsed.input.companyName, 'Carlos Publicidad');
  assert.equal(parsed.input.whatsapp, '+505 8888 0000');
  const routed = detectOwnerCommand(message);
  assert.equal(routed.type, OWNER_COMMANDS.BUSINESS_TRANSACTION);
  assert.equal(routed.businessCommand.type, BUSINESS_COMMANDS.CUSTOMER_CREATE);
});

test('Owner natural price authorization is scoped to seller dimensions destination and amount', () => {
  const parsed = parsePriceAuthorization('Apruebo precio para la vendedora Valentina por un rótulo de 1x1 instalado en Granada por 300 dólares');
  assert.equal(parsed.type, BUSINESS_COMMANDS.PRICE_AUTH_CREATE);
  assert.equal(parsed.authorization.sellerId, 'Valentina');
  assert.equal(parsed.authorization.width, 1);
  assert.equal(parsed.authorization.height, 1);
  assert.equal(parsed.authorization.destination, 'Granada');
  assert.equal(parsed.authorization.price, 300);
  assert.equal(parsed.authorization.currency, 'USD');
});

test('Business context persists references only and ignores arbitrary business payloads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-context-'));
  const env = { OWNER_BUSINESS_CONTEXT_STORE_PATH: path.join(dir, 'context.json') };
  await updateContext({ activeCustomerId: 'customer-1', activeProjectId: 'project-1', customerName: 'SHOULD_NOT_PERSIST', total: 999 }, env);
  const context = await readContext(env);
  assert.equal(context.activeCustomerId, 'customer-1');
  assert.equal(context.activeProjectId, 'project-1');
  assert.equal(context.customerName, undefined);
  assert.equal(context.total, undefined);
});
