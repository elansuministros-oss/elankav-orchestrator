'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATUS,
  buildRegistryCoverage,
  formatElanSelfAudit,
  runElanSelfAudit
} = require('../services/elanSelfAuditService');

function successfulOptions(overrides = {}) {
  return {
    readProductionAuditImpl: async () => ({
      services: {
        connect: { active: 'active' },
        orchestrator: { active: 'active' }
      },
      secretsExposed: false
    }),
    readWahaSessionImpl: async () => ({ status: 'WORKING' }),
    listCustomersImpl: async () => ({ data: [{ id: 'c-1' }, { id: 'c-2' }] }),
    listQuotationsImpl: async () => ({ data: [{ id: 'q-1' }] }),
    listPriceAuthorizationsImpl: async () => ({ data: [] }),
    listLogisticsRulesImpl: async () => ({ data: [{ id: 'l-1' }] }),
    listOwnerFamilyImpl: async () => ({ data: [{ id: 'f-1' }] }),
    listOwnerSellersImpl: async () => ({ data: new Array(7).fill(null).map((_, index) => ({ id: `s-${index}` })) }),
    listOwnerProvidersImpl: async () => ({ data: [{ id: 'p-1' }, { id: 'p-2' }, { id: 'p-3' }] }),
    ...overrides
  };
}

test('self-audit validates live READ capabilities and never executes writes', async () => {
  const report = await runElanSelfAudit(successfulOptions());

  assert.equal(report.readOnly, true);
  assert.equal(report.writesExecuted, false);
  assert.equal(report.secretsExposed, false);
  assert.equal(report.summary.total, 51);
  assert.equal(report.summary.available, 11);
  assert.equal(report.summary.degraded, 40);
  assert.equal(report.summary.unavailable, 0);
  assert.equal(report.diagnostics.sellerCount, 7);
  assert.equal(report.diagnostics.providerCount, 3);
  assert.equal(report.diagnostics.familyCount, 1);
  assert.equal(report.diagnostics.customerCount, 2);
  assert.equal(report.diagnostics.quotationCount, 1);
  assert.equal(report.diagnostics.registryComplete, true);
  assert.equal(report.registryCoverage.gaps.length, 0);
  assert.deepEqual(report.roleAccess.owner, ['*']);
  assert.ok(report.roleAccess.seller.includes('customer.own.create'));
  assert.ok(report.roleAccess.family.includes('design.create'));

  const customerRead = report.capabilities.find((item) => item.id === 'business.customer.read');
  assert.equal(customerRead.status, STATUS.AVAILABLE);
  assert.equal(customerRead.verificationLevel, 'LIVE_READ');

  const sellerRead = report.capabilities.find((item) => item.id === 'business.seller.read');
  assert.equal(sellerRead.status, STATUS.AVAILABLE);

  const customerCreate = report.capabilities.find((item) => item.id === 'business.customer.create');
  assert.equal(customerCreate.status, STATUS.DEGRADED);
  assert.equal(customerCreate.reason, 'SAFE_DRY_RUN_PROBE_REQUIRED');
});

test('self-audit reports a failed authority probe as UNAVAILABLE instead of hiding it', async () => {
  const error = Object.assign(new Error('customer authority down'), { code: 'CUSTOMER_AUTHORITY_UNAVAILABLE' });
  const report = await runElanSelfAudit(successfulOptions({
    listCustomersImpl: async () => { throw error; }
  }));

  const customerRead = report.capabilities.find((item) => item.id === 'business.customer.read');
  assert.equal(customerRead.status, STATUS.UNAVAILABLE);
  assert.equal(customerRead.reason, 'CUSTOMER_AUTHORITY_UNAVAILABLE');
  assert.equal(report.summary.unavailable, 1);
  assert.deepEqual(report.probeErrors, [
    { probe: 'customers', error: 'CUSTOMER_AUTHORITY_UNAVAILABLE' }
  ]);
});

test('registry coverage exposes any wired CONNECT function that is not represented', () => {
  const coverage = buildRegistryCoverage(
    [{ id: 'business.customer.read' }],
    {
      searchCustomers() {},
      futureUnregisteredOperation() {},
      requestConnect() {}
    }
  );

  assert.equal(coverage.complete, false);
  assert.ok(coverage.gaps.includes('function:futureUnregisteredOperation'));
});

test('self-audit output tells Owner exactly what is verified and what still lacks a safe probe', async () => {
  const report = await runElanSelfAudit(successfulOptions());
  const output = formatElanSelfAudit(report);

  assert.match(output, /ELAN SELF-AUDIT/);
  assert.match(output, /Capacidades registradas: 51/);
  assert.match(output, /AVAILABLE: 11/);
  assert.match(output, /DEGRADED: 40/);
  assert.match(output, /Vendedores: AVAILABLE \(7\)/);
  assert.match(output, /Familia: AVAILABLE \(1\)/);
  assert.match(output, /Registro de capacidades: COMPLETO/);
  assert.match(output, /MATRIZ DE ACCESO/);
  assert.match(output, /Owner: \*/);
  assert.match(output, /Seller: 10 scopes/);
  assert.match(output, /Customer: 6 scopes/);
  assert.match(output, /Provider: 3 scopes/);
  assert.match(output, /Family: 5 scopes/);
  assert.match(output, /Prospect: 3 scopes/);
  assert.match(output, /business\.customer\.create: DEGRADED — SAFE_DRY_RUN_PROBE_REQUIRED/);
  assert.match(output, /Escrituras ejecutadas: NO/);
  assert.match(output, /Secretos expuestos: NO/);
});
