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
  parseLogisticsRule,
  parsePriceAuthorization
} = require('../services/ownerBusinessCommandService');
const { readContext, updateContext } = require('../services/ownerBusinessContextService');
const {
  parseQuotationRequest,
  selectDistanceRule,
  selectLogisticsRule
} = require('../services/ownerQuotationService');
const { waypoint } = require('../services/ownerRoutingService');

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

test('Official CONNECT price authorization fields match quotation scope', () => {
  const result = resolveAuthorizedPrice({
    role: 'VENDEDOR',
    officialPrice: 340,
    quote: { sellerId: 'VALENTINA', productDescription: 'Rótulo botón', width: 1, height: 1, quantity: 1, destination: 'granada' },
    authorizations: [{
      id: 'PA-002', status: 'active', sellerId: 'Valentina', productDescription: 'rotulo boton', width: 1, height: 1, quantity: 1, destination: 'Granada', price: 300
    }]
  });
  assert.equal(result.allowed, true);
  assert.equal(result.price, 300);
  assert.equal(result.authorizationId, 'PA-002');
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

test('Natural quote request extracts product dimensions and asks logistics separately', () => {
  const parsed = parseQuotationRequest('Cotízame una impresión en lona banner impresión UV tamaño 2x1 instalada');
  assert.ok(parsed);
  assert.equal(parsed.width, 2);
  assert.equal(parsed.height, 1);
  assert.equal(parsed.quantity, 1);
  assert.match(parsed.productQuery, /lona banner/i);
  assert.equal(parsed.destination, undefined);
  const routed = detectOwnerCommand('Cotízame una impresión en lona banner impresión UV tamaño 2x1 instalada');
  assert.equal(routed.type, OWNER_COMMANDS.BUSINESS_TRANSACTION);
  assert.equal(routed.businessCommand.type, BUSINESS_COMMANDS.QUOTATION_CREATE);
});

test('Natural carrier quote extracts Cargo Trans and destination', () => {
  const parsed = parseQuotationRequest('Cotiza lona banner UV 2x1 enviar por Cargo Trans a Estelí');
  assert.ok(parsed);
  assert.equal(parsed.carrier, 'Cargo Trans');
  assert.equal(parsed.destination, 'Estelí');
});

test('Logistics rule selection respects carrier destination and distance policy', () => {
  const rules = [
    { id: 'distance-1', serviceType: 'distance', pricingUnit: 'per_km', rate: 0.6, currency: 'USD' },
    { id: 'carrier-1', serviceType: 'carrier', provider: 'Cargo Trans', destination: 'Estelí', pricingUnit: 'flat', rate: 350, currency: 'NIO' }
  ];
  const carrier = selectLogisticsRule(rules, { method: DELIVERY_METHODS.CARRIER, carrier: 'cargo trans', destination: 'esteli' });
  assert.equal(carrier.id, 'carrier-1');
  assert.equal(selectDistanceRule(rules).id, 'distance-1');
});

test('Routing adapter accepts both address and GPS coordinates without exposing credentials', () => {
  assert.deepEqual(waypoint('Granada, Nicaragua'), { address: 'Granada, Nicaragua' });
  assert.deepEqual(waypoint({ latitude: 11.9344, longitude: -85.956 }), {
    location: { latLng: { latitude: 11.9344, longitude: -85.956 } }
  });
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

test('Owner can teach Cargo Trans route tariff in natural language', () => {
  const parsed = parseLogisticsRule('ELAN guarda que Cargo Trans cobra C$350 de Managua a Estelí.');
  assert.equal(parsed.type, BUSINESS_COMMANDS.LOGISTICS_RULE_CREATE);
  assert.equal(parsed.rule.provider, 'Cargo Trans');
  assert.equal(parsed.rule.serviceType, 'carrier');
  assert.equal(parsed.rule.origin, 'Managua');
  assert.equal(parsed.rule.destination, 'Estelí');
  assert.equal(parsed.rule.pricingUnit, 'flat');
  assert.equal(parsed.rule.rate, 350);
  assert.equal(parsed.rule.currency, 'NIO');
});

test('Owner can teach a local delivery flat rate', () => {
  const parsed = parseLogisticsRule('Guarda que delivery dentro de Managua cuesta US$8.');
  assert.equal(parsed.type, BUSINESS_COMMANDS.LOGISTICS_RULE_CREATE);
  assert.equal(parsed.rule.serviceType, 'delivery');
  assert.equal(parsed.rule.destination, 'Managua');
  assert.equal(parsed.rule.rate, 8);
  assert.equal(parsed.rule.currency, 'USD');
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

test('Owner mode router accepts ELAN comma natural activation and cambia modo a', () => {
  const {
    detectOwnerCommand,
    OWNER_COMMANDS
  } = require('../services/ownerCommandService');

  const natural = detectOwnerCommand(
    'ELAN, actúa como asistente de ventas.'
  );

  assert.equal(natural?.type, OWNER_COMMANDS.MODE_SET);
  assert.equal(natural?.mode, 'VENTAS');

  const canonical = detectOwnerCommand(
    'ELAN, cambia modo a VENTAS.'
  );

  assert.equal(canonical?.type, OWNER_COMMANDS.MODE_SET);
  assert.equal(canonical?.mode, 'VENTAS');
});

test('Owner mode router accepts common voice transcription variants', () => {
  const {
    detectOwnerCommand,
    OWNER_COMMANDS
  } = require('../services/ownerCommandService');

  const samples = [
    'elan actua como asistente de ventas',
    'elan, actua como asistente de ventas',
    'ELAN actúa como asistente de ventas.',
    'elan cambia modo a ventas',
    'cambia modo a ventas',
    'ponte en modo ventas',
    'entra en modo ventas'
  ];

  for (const sample of samples) {
    const parsed = detectOwnerCommand(sample);

    assert.equal(
      parsed?.type,
      OWNER_COMMANDS.MODE_SET,
      `No reconoció como MODE_SET: ${sample}`
    );

    assert.equal(
      parsed?.mode,
      'VENTAS',
      `No resolvió VENTAS: ${sample}`
    );
  }
});
