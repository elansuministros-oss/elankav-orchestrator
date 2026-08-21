import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value, 'utf8'); }
function replaceOnce(path, from, to) {
  const source = read(path);
  if (source.includes(to)) return false;
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`PATCH_ANCHOR_INVALID:${path}:${from.slice(0, 80)}`);
  }
  write(path, source.slice(0, first) + to + source.slice(first + from.length));
  return true;
}

const owner = 'services/ownerCommandService.js';
replaceOnce(owner,
`const {
  getCapability
} = require('./ownerOpsCapabilityRegistry');`,
`const {
  getCapability
} = require('./ownerOpsCapabilityRegistry');
const { formatElanSelfAudit } = require('./elanSelfAuditService');
const { runTrackedSelfAudit } = require('./elanSelfAuditMonitorService');`);

replaceOnce(owner,
`  LANGUAGE_LEARN: 'language_learn',
  BUSINESS_TRANSACTION: 'business_transaction'`,
`  LANGUAGE_LEARN: 'language_learn',
  SELF_AUDIT: 'self_audit',
  BUSINESS_TRANSACTION: 'business_transaction'`);

replaceOnce(owner,
`const TECHNICAL_ACTION_QUERY_PATTERN =
  /\\b(service\\.restart|service\\.logs|git\\.status|file\\.inspect|test\\.run|reiniciar|reinicia|restart|logs|git|tests?|pruebas?|deploy|archivo|repositorio)\\b/;

function normalizeCommand(value) {`,
`const TECHNICAL_ACTION_QUERY_PATTERN =
  /\\b(service\\.restart|service\\.logs|git\\.status|file\\.inspect|test\\.run|reiniciar|reinicia|restart|logs|git|tests?|pruebas?|deploy|archivo|repositorio)\\b/;

const SELF_AUDIT_PATTERN = /\\b(auditate|autoaudita|auto audita|audita tus capacidades|audita tus accesos|audita lo que puedes|audita lo que podes|revisa tus capacidades|revisa tus accesos|que te falta|que podes hacer realmente|que puedes hacer realmente|estado de tus capacidades)\\b/;

function normalizeCommand(value) {`);

replaceOnce(owner,
`function cleanOwnerLanguageLearnValue(value) {`,
`function detectElanSelfAuditCommand(normalizedMessage) {
  if (!SELF_AUDIT_PATTERN.test(normalizedMessage)) return null;
  return Object.freeze({ type: OWNER_COMMANDS.SELF_AUDIT });
}

function cleanOwnerLanguageLearnValue(value) {`);

replaceOnce(owner,
`  const opsStatusCommand = detectOpsStatusCommand(message, normalized);
  if (opsStatusCommand) return opsStatusCommand;

  const permissionCommand =`,
`  const opsStatusCommand = detectOpsStatusCommand(message, normalized);
  if (opsStatusCommand) return opsStatusCommand;

  const selfAuditCommand = detectElanSelfAuditCommand(normalized);
  if (selfAuditCommand) return selfAuditCommand;

  const permissionCommand =`);

replaceOnce(owner,
`async function executeOwnerCommand({ command, platform }) {
  const type = typeof command === 'string' ? command : command?.type;

  if (type === OWNER_COMMANDS.MODE_GET) {`,
`async function executeOwnerCommand({ command, platform, ownerPhone = null }) {
  const type = typeof command === 'string' ? command : command?.type;

  if (type === OWNER_COMMANDS.SELF_AUDIT) {
    const tracked = await runTrackedSelfAudit({ source: 'owner-command', ownerPhone });
    return {
      command: type,
      job: null,
      outputText: formatElanSelfAudit(tracked.report),
      selfAudit: tracked.report
    };
  }

  if (type === OWNER_COMMANDS.MODE_GET) {`);

replaceOnce(owner,
`  detectOwnerCommand,
  detectOwnerLanguageLearnCommand,`,
`  detectOwnerCommand,
  detectElanSelfAuditCommand,
  detectOwnerLanguageLearnCommand,`);

const message = 'services/messageService.js';
replaceOnce(message,
`        const commandResult = await executeOwnerCommand({ command: ownerCommand, platform: context.platform || platform || 'elankav' });`,
`        const commandResult = await executeOwnerCommand({
          command: ownerCommand,
          platform: context.platform || platform || 'elankav',
          ownerPhone: context.phone || phone || context?.identity?.canonicalId || null
        });`);

const server = 'server.js';
replaceOnce(server,
`const {
  getDesignPortalWorkerState,
  startDesignPortalWorker
} = require('./services/designPortalWorkerService');`,
`const {
  getDesignPortalWorkerState,
  startDesignPortalWorker
} = require('./services/designPortalWorkerService');
const { startElanSelfAuditMonitor } = require('./services/elanSelfAuditMonitorService');`);
replaceOnce(server,
`  startDesignPortalWorker();

  server.listen(PORT, HOST, () => {`,
`  startDesignPortalWorker();
  startElanSelfAuditMonitor();

  server.listen(PORT, HOST, () => {`);

const registry = 'services/ownerOpsCapabilityRegistry.js';
replaceOnce(registry,
`  'business.logistics.rule.write': Object.freeze({ id: 'business.logistics.rule.write', risk: RISK.LOW_RISK, description: 'Registra una regla logística proporcionada por Owner sin crear transacciones financieras.' })
});`,
`  'business.logistics.rule.write': Object.freeze({ id: 'business.logistics.rule.write', risk: RISK.LOW_RISK, description: 'Registra una regla logística proporcionada por Owner sin crear transacciones financieras.' }),
  'business.customer.update': Object.freeze({ id: 'business.customer.update', risk: RISK.LOW_RISK, description: 'Actualiza o desactiva un cliente en la autoridad oficial.' }),
  'business.provider.read': Object.freeze({ id: 'business.provider.read', risk: RISK.READ, description: 'Consulta proveedores oficiales mediante CONNECT.' }),
  'business.provider.create': Object.freeze({ id: 'business.provider.create', risk: RISK.LOW_RISK, description: 'Crea un proveedor oficial mediante CONNECT.' }),
  'business.provider.update': Object.freeze({ id: 'business.provider.update', risk: RISK.LOW_RISK, description: 'Actualiza o desactiva un proveedor oficial.' }),
  'business.seller.read': Object.freeze({ id: 'business.seller.read', risk: RISK.READ, description: 'Consulta vendedores oficiales y sus plataformas.' }),
  'business.seller.create': Object.freeze({ id: 'business.seller.create', risk: RISK.CONFIRM_REQUIRED, description: 'Registra un vendedor y acceso comercial.' }),
  'business.seller.update': Object.freeze({ id: 'business.seller.update', risk: RISK.CONFIRM_REQUIRED, description: 'Actualiza o desactiva un vendedor.' }),
  'business.seller.delete': Object.freeze({ id: 'business.seller.delete', risk: RISK.CONFIRM_REQUIRED, description: 'Elimina un vendedor cuando la política lo permite.' }),
  'business.seller.platforms.write': Object.freeze({ id: 'business.seller.platforms.write', risk: RISK.CONFIRM_REQUIRED, description: 'Administra plataformas permitidas de un vendedor.' }),
  'business.family.read': Object.freeze({ id: 'business.family.read', risk: RISK.READ, description: 'Consulta integrantes familiares registrados.' }),
  'business.family.create': Object.freeze({ id: 'business.family.create', risk: RISK.CONFIRM_REQUIRED, description: 'Registra un integrante familiar.' }),
  'business.family.update': Object.freeze({ id: 'business.family.update', risk: RISK.CONFIRM_REQUIRED, description: 'Actualiza o desactiva un integrante familiar.' }),
  'business.contact.read': Object.freeze({ id: 'business.contact.read', risk: RISK.READ, description: 'Busca contactos oficiales en CONNECT.' }),
  'business.price.read': Object.freeze({ id: 'business.price.read', risk: RISK.READ, description: 'Consulta catálogo y precios oficiales autorizados.' }),
  'business.price.resolve': Object.freeze({ id: 'business.price.resolve', risk: RISK.READ, description: 'Resuelve precio oficial aplicable para una solicitud.' }),
  'business.quotation.update': Object.freeze({ id: 'business.quotation.update', risk: RISK.LOW_RISK, description: 'Actualiza una cotización oficial.' }),
  'business.quotation.media.update': Object.freeze({ id: 'business.quotation.media.update', risk: RISK.LOW_RISK, description: 'Administra imágenes de una cotización oficial.' }),
  'business.payment.read': Object.freeze({ id: 'business.payment.read', risk: RISK.READ, description: 'Consulta pagos oficiales de una cotización.' }),
  'business.design.read': Object.freeze({ id: 'business.design.read', risk: RISK.READ, description: 'Consulta estado de solicitudes de diseño.' }),
  'business.design.create': Object.freeze({ id: 'business.design.create', risk: RISK.LOW_RISK, description: 'Crea una solicitud de diseño oficial.' }),
  'business.design.update': Object.freeze({ id: 'business.design.update', risk: RISK.LOW_RISK, description: 'Revisa o actualiza una solicitud de diseño.' }),
  'business.design.send-whatsapp': Object.freeze({ id: 'business.design.send-whatsapp', risk: RISK.CONFIRM_REQUIRED, description: 'Envía un diseño por WhatsApp.' }),
  'business.whatsapp.send': Object.freeze({ id: 'business.whatsapp.send', risk: RISK.CONFIRM_REQUIRED, description: 'Envía un mensaje WhatsApp desde el gateway oficial.' })
});`);

const selfAudit = 'services/elanSelfAuditService.js';
let source = read(selfAudit);
if (!source.includes('BUSINESS_WIRING_MAP')) {
  source = source.replace(
`const { listCapabilities } = require('./ownerOpsCapabilityRegistry');`,
`const { listCapabilities } = require('./ownerOpsCapabilityRegistry');
const { ROLE_SCOPES } = require('./accessPolicyService');
const ownerBusinessConnectClient = require('./ownerBusinessConnectClient');`);
  source = source.replace(
`const {
  listCustomers,
  listLogisticsRules,
  listOwnerProviders,
  listOwnerSellers,
  listPriceAuthorizations,
  listQuotations
} = require('./ownerBusinessConnectClient');`,
`const {
  listCustomers,
  listLogisticsRules,
  listOwnerFamily,
  listOwnerProviders,
  listOwnerSellers,
  listPriceAuthorizations,
  listQuotations
} = ownerBusinessConnectClient;`);
  source = source.replace(
`  'business.logistics.read': 'logisticsRules'
});`,
`  'business.logistics.read': 'logisticsRules',
  'business.provider.read': 'providers',
  'business.seller.read': 'sellers',
  'business.family.read': 'family'
});`);
  source = source.replace(
`const INFRA_FROM_PRODUCTION_AUDIT = new Set([
  'production.audit',
  'server.summary',
  'service.status',
  'git.status'
]);`,
`const INFRA_FROM_PRODUCTION_AUDIT = new Set([
  'production.audit',
  'server.summary',
  'service.status',
  'git.status'
]);

const BUSINESS_CLIENT_IGNORE = new Set(['OwnerBusinessConnectError', 'normalizeQuotationSource', 'requestConnect']);
const BUSINESS_WIRING_MAP = Object.freeze({
  applyPayment: 'business.payment.apply', createAndProcessDesign: 'business.design.create', createCustomer: 'business.customer.create', createDesignRequest: 'business.design.create', createLogisticsRule: 'business.logistics.rule.write', createOwnerCustomer: 'business.customer.create', createOwnerFamily: 'business.family.create', createOwnerProvider: 'business.provider.create', createOwnerSeller: 'business.seller.create', createPriceAuthorization: 'business.price-authorization.create', createQuotation: 'business.quotation.create', createWorkOrder: 'business.work-order.create', deactivateOwnerCustomer: 'business.customer.update', deactivateOwnerFamily: 'business.family.update', deactivateOwnerProvider: 'business.provider.update', deactivateOwnerSeller: 'business.seller.update', deleteOwnerSeller: 'business.seller.delete', getDesignRequest: 'business.design.read', getPayment: 'business.payment.read', getQuotation: 'business.quotation.read', listAuthorizedPrices: 'business.price.read', listCustomers: 'business.customer.read', listLogisticsRules: 'business.logistics.read', listOwnerCustomers: 'business.customer.read', listOwnerFamily: 'business.family.read', listOwnerProviders: 'business.provider.read', listOwnerSellers: 'business.seller.read', listPayments: 'business.payment.read', listPriceAuthorizations: 'business.price-authorization.read', listProviders: 'business.provider.read', listQuotations: 'business.quotation.read', listWorkOrders: 'business.work-order.read', removeQuotationImage: 'business.quotation.media.update', resolveCatalogPricing: 'business.price.resolve', reviseDesignRequest: 'business.design.update', revokePriceAuthorization: 'business.price-authorization.revoke', searchCustomers: 'business.customer.read', searchOwnerContacts: 'business.contact.read', searchProviders: 'business.provider.read', sendDesignWhatsApp: 'business.design.send-whatsapp', sendOwnerWhatsApp: 'business.whatsapp.send', sendQuotationWhatsApp: 'business.quotation.send-whatsapp', setOwnerSellerPlatforms: 'business.seller.platforms.write', updateOwnerCustomer: 'business.customer.update', updateOwnerFamily: 'business.family.update', updateOwnerProvider: 'business.provider.update', updateOwnerSeller: 'business.seller.update', updateQuotation: 'business.quotation.update', uploadQuotationImage: 'business.quotation.media.update'
});`);
  source = source.replace(
`function summarize(capabilities) {`,
`function buildRegistryCoverage(registeredCapabilities, client = ownerBusinessConnectClient) {
  const registeredIds = new Set((registeredCapabilities || []).map(item => item.id));
  const wiredFunctions = Object.keys(client).filter(name => typeof client[name] === 'function' && !BUSINESS_CLIENT_IGNORE.has(name));
  const unmappedFunctions = wiredFunctions.filter(name => !BUSINESS_WIRING_MAP[name]);
  const mappedCapabilityIds = [...new Set(wiredFunctions.map(name => BUSINESS_WIRING_MAP[name]).filter(Boolean))];
  const unregisteredCapabilities = mappedCapabilityIds.filter(id => !registeredIds.has(id));
  const gaps = [...unmappedFunctions.map(name => \`function:\${name}\`), ...unregisteredCapabilities];
  return Object.freeze({ complete: gaps.length === 0, wiredFunctionCount: wiredFunctions.length, mappedCapabilityCount: mappedCapabilityIds.length, registeredCapabilityCount: registeredIds.size, gaps });
}

function buildRoleAccessMatrix() {
  return Object.freeze({
    owner: Object.freeze(['*']),
    ...Object.fromEntries(Object.entries(ROLE_SCOPES).map(([role, scopes]) => [role, Object.freeze([...scopes])]))
  });
}

function summarize(capabilities) {`);
  source = source.replace(
`    listLogisticsRules: options.listLogisticsRulesImpl || listLogisticsRules,
    listOwnerSellers: options.listOwnerSellersImpl || listOwnerSellers,`,
`    listLogisticsRules: options.listLogisticsRulesImpl || listLogisticsRules,
    listOwnerFamily: options.listOwnerFamilyImpl || listOwnerFamily,
    listOwnerSellers: options.listOwnerSellersImpl || listOwnerSellers,`);
  source = source.replace(
`  const [production, waha, customers, quotations, priceAuthorizations, logisticsRules, sellers, providers] = await Promise.all([`,
`  const [production, waha, customers, quotations, priceAuthorizations, logisticsRules, family, sellers, providers] = await Promise.all([`);
  source = source.replace(
`    safeProbe('logisticsRules', () => deps.listLogisticsRules()),
    safeProbe('sellers', () => deps.listOwnerSellers()),`,
`    safeProbe('logisticsRules', () => deps.listLogisticsRules()),
    safeProbe('family', () => deps.listOwnerFamily()),
    safeProbe('sellers', () => deps.listOwnerSellers()),`);
  source = source.replace(
`  const probes = { production, waha, customers, quotations, priceAuthorizations, logisticsRules, sellers, providers };
  const registered = deps.listCapabilities();
  const capabilities = registered.map((capability) => evaluateCapability(capability, probes));
  const summary = summarize(capabilities);`,
`  const probes = { production, waha, customers, quotations, priceAuthorizations, logisticsRules, family, sellers, providers };
  const registered = deps.listCapabilities();
  const capabilities = registered.map((capability) => evaluateCapability(capability, probes));
  const summary = summarize(capabilities);
  const registryCoverage = buildRegistryCoverage(registered, options.ownerBusinessConnectClientImpl || ownerBusinessConnectClient);
  const roleAccess = buildRoleAccessMatrix();`);
  source = source.replace(
`    providers: providers.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    providerCount: providers.ok ? safeCount(providers.value) : null,`,
`    providers: providers.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    providerCount: providers.ok ? safeCount(providers.value) : null,
    family: family.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    familyCount: family.ok ? safeCount(family.value) : null,
    registryComplete: registryCoverage.complete,
    registryGapCount: registryCoverage.gaps.length,`);
  source = source.replace(
`    diagnostics,
    capabilities,`,
`    diagnostics,
    registryCoverage,
    roleAccess,
    capabilities,`);
  source = source.replace(
`    \`Proveedores: \${diagnostics.providers || STATUS.UNAVAILABLE}\${diagnostics.providerCount == null ? '' : \` (\${diagnostics.providerCount})\`}\`,
    \`Clientes visibles:`,
`    \`Proveedores: \${diagnostics.providers || STATUS.UNAVAILABLE}\${diagnostics.providerCount == null ? '' : \` (\${diagnostics.providerCount})\`}\`,
    \`Familia: \${diagnostics.family || STATUS.UNAVAILABLE}\${diagnostics.familyCount == null ? '' : \` (\${diagnostics.familyCount})\`}\`,
    \`Registro de capacidades: \${diagnostics.registryComplete === false ? 'INCOMPLETO' : 'COMPLETO'}\${diagnostics.registryGapCount ? \` (\${diagnostics.registryGapCount} gaps)\` : ''}\`,
    \`Clientes visibles:`);
  source = source.replace(
`  STATUS,
  LIVE_READ_PROBES,`,
`  STATUS,
  BUSINESS_WIRING_MAP,
  LIVE_READ_PROBES,
  buildRegistryCoverage,
  buildRoleAccessMatrix,`);
  write(selfAudit, source);
}

console.log('ELAN_SELF_AUDIT_INTEGRATION_PATCH_APPLIED');
