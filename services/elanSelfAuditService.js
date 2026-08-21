'use strict';

const { listCapabilities } = require('./ownerOpsCapabilityRegistry');
const { readProductionAudit } = require('./ownerOpsReadService');
const { readWahaSession } = require('./ownerOperationalReadService');
const {
  listCustomers,
  listLogisticsRules,
  listOwnerProviders,
  listOwnerSellers,
  listPriceAuthorizations,
  listQuotations
} = require('./ownerBusinessConnectClient');

const STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_GRANTED: 'NOT_GRANTED'
});

const LIVE_READ_PROBES = Object.freeze({
  'business.customer.read': 'customers',
  'business.quotation.read': 'quotations',
  'business.price-authorization.read': 'priceAuthorizations',
  'business.logistics.read': 'logisticsRules'
});

const INFRA_FROM_PRODUCTION_AUDIT = new Set([
  'production.audit',
  'server.summary',
  'service.status',
  'git.status'
]);

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

async function safeProbe(name, fn) {
  try {
    const value = await fn();
    return Object.freeze({ name, ok: true, value, error: null });
  } catch (error) {
    return Object.freeze({ name, ok: false, value: null, error: errorCode(error) });
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
    listOwnerSellers: options.listOwnerSellersImpl || listOwnerSellers,
    listOwnerProviders: options.listOwnerProvidersImpl || listOwnerProviders
  };

  const [production, waha, customers, quotations, priceAuthorizations, logisticsRules, sellers, providers] = await Promise.all([
    safeProbe('production', () => deps.readProductionAudit()),
    safeProbe('waha', () => deps.readWahaSession()),
    safeProbe('customers', () => deps.listCustomers()),
    safeProbe('quotations', () => deps.listQuotations()),
    safeProbe('priceAuthorizations', () => deps.listPriceAuthorizations()),
    safeProbe('logisticsRules', () => deps.listLogisticsRules()),
    safeProbe('sellers', () => deps.listOwnerSellers()),
    safeProbe('providers', () => deps.listOwnerProviders())
  ]);

  const probes = { production, waha, customers, quotations, priceAuthorizations, logisticsRules, sellers, providers };
  const registered = deps.listCapabilities();
  const capabilities = registered.map((capability) => evaluateCapability(capability, probes));
  const summary = summarize(capabilities);

  const diagnostics = Object.freeze({
    production: production.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    waha: waha.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    sellers: sellers.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    sellerCount: sellers.ok ? safeCount(sellers.value) : null,
    providers: providers.ok ? STATUS.AVAILABLE : STATUS.UNAVAILABLE,
    providerCount: providers.ok ? safeCount(providers.value) : null,
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
    `Clientes visibles: ${diagnostics.customerCount == null ? 'no disponible' : diagnostics.customerCount}`,
    `Cotizaciones visibles: ${diagnostics.quotationCount == null ? 'no disponible' : diagnostics.quotationCount}`,
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
  LIVE_READ_PROBES,
  evaluateCapability,
  formatElanSelfAudit,
  runElanSelfAudit,
  safeCount,
  safeProbe,
  summarize
};
