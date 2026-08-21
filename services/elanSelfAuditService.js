'use strict';

const { listCapabilities } = require('./ownerOpsCapabilityRegistry');
const { ROLE_SCOPES } = require('./accessPolicyService');
const ownerBusinessConnectClient = require('./ownerBusinessConnectClient');
const { readProductionAudit } = require('./ownerOpsReadService');
const { readWahaSession } = require('./ownerOperationalReadService');
const {
  listCustomers,
  listLogisticsRules,
  listOwnerFamily,
  listOwnerProviders,
  listOwnerSellers,
  listPriceAuthorizations,
  listQuotations
} = ownerBusinessConnectClient;

const STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_GRANTED: 'NOT_GRANTED'
});

const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

const LIVE_READ_PROBES = Object.freeze({
  'business.customer.read': 'customers',
  'business.quotation.read': 'quotations',
  'business.price-authorization.read': 'priceAuthorizations',
  'business.logistics.read': 'logisticsRules',
  'business.provider.read': 'providers',
  'business.seller.read': 'sellers',
  'business.family.read': 'family'
});

const INFRA_FROM_PRODUCTION_AUDIT = new Set([
  'production.audit',
  'server.summary',
  'service.status',
  'git.status'
]);

const BUSINESS_CLIENT_IGNORE = new Set(['OwnerBusinessConnectError', 'normalizeQuotationSource', 'requestConnect']);
const BUSINESS_WIRING_MAP = Object.freeze({
  applyPayment: 'business.payment.apply', createAndProcessDesign: 'business.design.create', createCustomer: 'business.customer.create', createDesignRequest: 'business.design.create', createLogisticsRule: 'business.logistics.rule.write', createOwnerCustomer: 'business.customer.create', createOwnerFamily: 'business.family.create', createOwnerProvider: 'business.provider.create', createOwnerSeller: 'business.seller.create', createPriceAuthorization: 'business.price-authorization.create', createQuotation: 'business.quotation.create', createWorkOrder: 'business.work-order.create', deactivateOwnerCustomer: 'business.customer.update', deactivateOwnerFamily: 'business.family.update', deactivateOwnerProvider: 'business.provider.update', deactivateOwnerSeller: 'business.seller.update', deleteOwnerSeller: 'business.seller.delete', getDesignRequest: 'business.design.read', getPayment: 'business.payment.read', getQuotation: 'business.quotation.read', listAuthorizedPrices: 'business.price.read', listCustomers: 'business.customer.read', listLogisticsRules: 'business.logistics.read', listOwnerCustomers: 'business.customer.read', listOwnerFamily: 'business.family.read', listOwnerProviders: 'business.provider.read', listOwnerSellers: 'business.seller.read', listPayments: 'business.payment.read', listPriceAuthorizations: 'business.price-authorization.read', listProviders: 'business.provider.read', listQuotations: 'business.quotation.read', listWorkOrders: 'business.work-order.read', removeQuotationImage: 'business.quotation.media.update', resolveCatalogPricing: 'business.price.resolve', reviseDesignRequest: 'business.design.update', revokePriceAuthorization: 'business.price-authorization.revoke', searchCustomers: 'business.customer.read', searchOwnerContacts: 'business.contact.read', searchProviders: 'business.provider.read', sendDesignWhatsApp: 'business.design.send-whatsapp', sendOwnerWhatsApp: 'business.whatsapp.send', sendQuotationWhatsApp: 'business.quotation.send-whatsapp', setOwnerSellerPlatforms: 'business.seller.platforms.write', updateOwnerCustomer: 'business.customer.update', updateOwnerFamily: 'business.family.update', updateOwnerProvider: 'business.provider.update', updateOwnerSeller: 'business.seller.update', updateQuotation: 'business.quotation.update', uploadQuotationImage: 'business.quotation.media.update'
});

function safeCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.data)) return payload.data.length;
  if (Array.isArray(payload?.rows)) return payload.rows.length;
  if (Number.isFinite(Number(payload?.count))) return Number(payload.count);
  if (Number.isFinite(Number(payload?.data?.count))) return Number(payload.data.count);
  return null;
}

function errorCode(error, fallback) {
  return String(error?.code || error?.message || fallback || 'SELF_AUDIT_PROBE_FAILED');
}

async function safeProbe(name, fn, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  let timer = null;
  try {
    const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS);
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('SELF_AUDIT_PROBE_TIMEOUT');
          error.code = 'SELF_AUDIT_PROBE_TIMEOUT';
          reject(error);
        }, timeout);
      })
    ]);
    return Object.freeze({ name, ok: true, value, error: null });
  } catch (error) {
    return Object.freeze({ name, ok: false, value: null, error: errorCode(error) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function capabilityDomain(id) {
  if (id.startsWith('business.')) return 'business';
  if (id.startsWith('service.') || id.startsWith('git.') || id.startsWith('server.') || id.startsWith('production.') || id.startsWith('file.') || id.startsWith('test.') || id.startsWith('repository.')) return 'infrastructure';
  return 'runtime';
}

function capabilityAuthority(id) {
  if (id.startsWith('business.')) return 'CONNECT';
  if (id.startsWith('service.') || id.startsWith('git.') || id.startsWith('server.') || id.startsWith('production.') || id.startsWith('file.') || id.startsWith('test.') || id.startsWith('repository.')) return 'ORCHESTRATOR/VPS';
  return 'ORCHESTRATOR';
}

function unavailableResult(capability, reason, evidence = {}) {
  return Object.freeze({
    id: capability.id,
    risk: capability.risk,
    domain: capabilityDomain(capability.id),
    authority: capabilityAuthority(capability.id),
    status: STATUS.UNAVAILABLE,
    verificationLevel: 'LIVE_READ',
    reason,
    evidence
  });
}

function degradedResult(capability, reason, verificationLevel = 'WIRING_ONLY') {
  return Object.freeze({
    id: capability.id,
    risk: capability.risk,
    domain: capabilityDomain(capability.id),
    authority: capabilityAuthority(capability.id),
    status: STATUS.DEGRADED,
    verificationLevel,
    reason,
    evidence: {}
  });
}

function availableResult(capability, verificationLevel, evidence = {}) {
  return Object.freeze({
    id: capability.id,
    risk: capability.risk,
    domain: capabilityDomain(capability.id),
    authority: capabilityAuthority(capability.id),
    status: STATUS.AVAILABLE,
    verificationLevel,
    reason: null,
    evidence
  });
}

function evaluateCapability(capability, probes) {
  if (INFRA_FROM_PRODUCTION_AUDIT.has(capability.id)) {
    const probe = probes.production;
    if (!probe?.ok) return unavailableResult(capability, probe?.error || 'PRODUCTION_AUDIT_UNAVAILABLE');

    const production = probe.value || {};
    if (capability.id === 'service.status') {
      const connect = production?.services?.connect?.active;
      const orchestrator = production?.services?.orchestrator?.active;
      const healthy = connect === 'active' && orchestrator === 'active';
      return healthy
        ? availableResult(capability, 'LIVE_READ', { connect, orchestrator })
        : unavailableResult(capability, 'SERVICE_NOT_ACTIVE', { connect, orchestrator });
    }

    return availableResult(capability, 'LIVE_READ', { source: 'production.audit' });
  }

  const businessProbeName = LIVE_READ_PROBES[capability.id];
  if (businessProbeName) {
    const probe = probes[businessProbeName];
    if (!probe?.ok) return unavailableResult(capability, probe?.error || `${businessProbeName.toUpperCase()}_UNAVAILABLE`);
    return availableResult(capability, 'LIVE_READ', { count: safeCount(probe.value) });
  }

  if (capability.risk === 'READ') {
    return degradedResult(capability, 'NO_LIVE_READ_PROBE_REGISTERED', 'REGISTERED_ONLY');
  }

  return degradedResult(capability, 'SAFE_DRY_RUN_PROBE_REQUIRED', 'WIRING_ONLY');
}

function buildRegistryCoverage(registeredCapabilities, client = ownerBusinessConnectClient) {
  const registeredIds = new Set((registeredCapabilities || []).map(item => item.id));
  const wiredFunctions = Object.keys(client).filter(name => typeof client[name] === 'function' && !BUSINESS_CLIENT_IGNORE.has(name));
  const unmappedFunctions = wiredFunctions.filter(name => !BUSINESS_WIRING_MAP[name]);
  const mappedCapabilityIds = [...new Set(wiredFunctions.map(name => BUSINESS_WIRING_MAP[name]).filter(Boolean))];
  const unregisteredCapabilities = mappedCapabilityIds.filter(id => !registeredIds.has(id));
  const gaps = [...unmappedFunctions.map(name => `function:${name}`), ...unregisteredCapabilities];
  return Object.freeze({ complete: gaps.length === 0, wiredFunctionCount: wiredFunctions.length, mappedCapabilityCount: mappedCapabilityIds.length, registeredCapabilityCount: registeredIds.size, gaps });
}

function buildRoleAccessMatrix() {
  return Object.freeze({
    owner: Object.freeze(['*']),
    ...Object.fromEntries(Object.entries(ROLE_SCOPES).map(([role, scopes]) => [role, Object.freeze([...scopes])]))
  });
}

function summarize(capabilities) {
  const counts = {
    [STATUS.AVAILABLE]: 0,
    [STATUS.DEGRADED]: 0,
    [STATUS.UNAVAILABLE]: 0,
    [STATUS.NOT_GRANTED]: 0
  };

  for (const capability of capabilities) {
    if (Object.prototype.hasOwnProperty.call(counts, capability.status)) counts[capability.status] += 1;
  }

  return Object.freeze({
    total: capabilities.length,
    available: counts[STATUS.AVAILABLE],
    degraded: counts[STATUS.DEGRADED],
    unavailable: counts[STATUS.UNAVAILABLE],
    notGranted: counts[STATUS.NOT_GRANTED],
    operationalPercent: capabilities.length
      ? Number(((counts[STATUS.AVAILABLE] / capabilities.length) * 100).toFixed(1))
      : 0
  });
}

async function runElanSelfAudit(options = {}) {
  const deps = {
    listCapabilities: options.listCapabilitiesImpl || listCapabilities,
    readProductionAudit: options.readProductionAuditImpl || readProductionAudit,
    readWahaSession: options.readWahaSessionImpl || readWahaSession,
    listCustomers: options.listCustomersImpl || listCustomers,
    listQuotations: options.listQuotationsImpl || listQuotations,
    listPriceAuthorizations: options.listPriceAuthorizationsImpl || listPriceAuthorizations,
    listLogisticsRules: options.listLogisticsRulesImpl || listLogisticsRules,
    listOwnerFamily: options.listOwnerFamilyImpl || listOwnerFamily,
    listOwnerSellers: options.listOwnerSellersImpl || listOwnerSellers,
    listOwnerProviders: options.listOwnerProvidersImpl || listOwnerProviders
  };

  const probeTimeoutMs = Math.max(1, Number(options.probeTimeoutMs) || DEFAULT_PROBE_TIMEOUT_MS);
  const [production, waha, customers, quotations, priceAuthorizations, logisticsRules, family, sellers, providers] = await Promise.all([
    safeProbe('production', () => deps.readProductionAudit(), probeTimeoutMs),
    safeProbe('waha', () => deps.readWahaSession(), probeTimeoutMs),
    safeProbe('customers', () => deps.listCustomers(), probeTimeoutMs),
    safeProbe('quotations', () => deps.listQuotations(), probeTimeoutMs),
    safeProbe('priceAuthorizations', () => deps.listPriceAuthorizations(), probeTimeoutMs),
    safeProbe('logisticsRules', () => deps.listLogisticsRules(), probeTimeoutMs),
    safeProbe('family', () => deps.listOwnerFamily(), probeTimeoutMs),
    safeProbe('sellers', () => deps.listOwnerSellers(), probeTimeoutMs),
    safeProbe('providers', () => deps.listOwnerProviders(), probeTimeoutMs)
  ]);

  const probes = { production, waha, customers, quotations, priceAuthorizations, logisticsRules, family, sellers, providers };
  const registered = deps.listCapabilities();
  const capabilities = registered.map((capability) => evaluateCapability(capability, probes));
  const summary = summarize(capabilities);
  const registryCoverage = buildRegistryCoverage(registered, options.ownerBusinessConnectClientImpl || ownerBusinessConnectClient);
  const roleAccess = buildRoleAccessMatrix();

  const diagnostics = Object.freeze({
    production: production.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    waha: waha.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    sellers: sellers.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    sellerCount: sellers.ok ? safeCount(sellers.value) : null,
    providers: providers.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    providerCount: providers.ok ? safeCount(providers.value) : null,
    family: family.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    familyCount: family.ok ? safeCount(family.value) : null,
    registryComplete: registryCoverage.complete,
    registryGapCount: registryCoverage.gaps.length,
    customerCount: customers.ok ? safeCount(customers.value) : null,
    quotationCount: quotations.ok ? safeCount(quotations.value) : null,
    secretsExposed: false
  });

  return Object.freeze({
    readOnly: true,
    generatedAt: new Date().toISOString(),
    statusModel: STATUS,
    summary,
    diagnostics,
    registryCoverage,
    roleAccess,
    capabilities,
    probeErrors: Object.values(probes)
      .filter((probe) => !probe.ok)
      .map((probe) => ({ probe: probe.name, error: probe.error })),
    writesExecuted: false,
    secretsExposed: false
  });
}

function formatElanSelfAudit(report) {
  const summary = report?.summary || {};
  const diagnostics = report?.diagnostics || {};
  const roleAccess = report?.roleAccess || {};
  const problems = (report?.capabilities || [])
    .filter((item) => item.status === STATUS.UNAVAILABLE || item.status === STATUS.DEGRADED)
    .slice(0, 12);

  return [
    '🔎 ELAN SELF-AUDIT — READ-ONLY',
    '',
    `Capacidades registradas: ${summary.total || 0}`,
    `AVAILABLE: ${summary.available || 0}`,
    `DEGRADED: ${summary.degraded || 0}`,
    `UNAVAILABLE: ${summary.unavailable || 0}`,
    `NOT_GRANTED: ${summary.notGranted || 0}`,
    `Cobertura operativa verificada: ${summary.operationalPercent || 0}%`,
    '',
    `Producción: ${diagnostics.production || STATUS.UNAVAILABLE}`,
    `WAHA: ${diagnostics.waha || STATUS.UNAVAILABLE}`,
    `Vendedores: ${diagnostics.sellers || STATUS.UNAVAILABLE}${diagnostics.sellerCount == null ? '' : ` (${diagnostics.sellerCount})`}`,
    `Proveedores: ${diagnostics.providers || STATUS.UNAVAILABLE}${diagnostics.providerCount == null ? '' : ` (${diagnostics.providerCount})`}`,
    `Familia: ${diagnostics.family || STATUS.UNAVAILABLE}${diagnostics.familyCount == null ? '' : ` (${diagnostics.familyCount})`}`,
    `Registro de capacidades: ${diagnostics.registryComplete === false ? 'INCOMPLETO' : 'COMPLETO'}${diagnostics.registryGapCount ? ` (${diagnostics.registryGapCount} gaps)` : ''}`,
    `Clientes visibles: ${diagnostics.customerCount == null ? 'no disponible' : diagnostics.customerCount}`,
    `Cotizaciones visibles: ${diagnostics.quotationCount == null ? 'no disponible' : diagnostics.quotationCount}`,
    '',
    'MATRIZ DE ACCESO',
    `Owner: ${Array.isArray(roleAccess.owner) ? roleAccess.owner.join(', ') : 'no disponible'}`,
    `Seller: ${Array.isArray(roleAccess.seller) ? roleAccess.seller.length : 0} scopes`,
    `Customer: ${Array.isArray(roleAccess.customer) ? roleAccess.customer.length : 0} scopes`,
    `Provider: ${Array.isArray(roleAccess.provider) ? roleAccess.provider.length : 0} scopes`,
    `Family: ${Array.isArray(roleAccess.family) ? roleAccess.family.length : 0} scopes`,
    `Prospect: ${Array.isArray(roleAccess.prospect) ? roleAccess.prospect.length : 0} scopes`,
    '',
    'PENDIENTES / FALLAS',
    ...(problems.length
      ? problems.map((item) => `- ${item.id}: ${item.status} — ${item.reason || 'sin detalle'}`)
      : ['- Ninguna detectada']),
    '',
    'Escrituras ejecutadas: NO',
    'Secretos expuestos: NO'
  ].join('\n');
}

module.exports = {
  STATUS,
  BUSINESS_WIRING_MAP,
  LIVE_READ_PROBES,
  buildRegistryCoverage,
  buildRoleAccessMatrix,
  evaluateCapability,
  formatElanSelfAudit,
  runElanSelfAudit,
  safeCount,
  safeProbe,
  summarize
};
