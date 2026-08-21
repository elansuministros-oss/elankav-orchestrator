import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value, 'utf8'); }
function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`PATCH_ANCHOR_INVALID:${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const auditPath = 'services/elanSelfAuditService.js';
let audit = read(auditPath);

if (!audit.includes('DEFAULT_PROBE_TIMEOUT_MS')) {
  audit = replaceOnce(
    audit,
    `const STATUS = Object.freeze({\n  AVAILABLE: 'AVAILABLE',\n  DEGRADED: 'DEGRADED',\n  UNAVAILABLE: 'UNAVAILABLE',\n  NOT_GRANTED: 'NOT_GRANTED'\n});`,
    `const STATUS = Object.freeze({\n  AVAILABLE: 'AVAILABLE',\n  DEGRADED: 'DEGRADED',\n  UNAVAILABLE: 'UNAVAILABLE',\n  NOT_GRANTED: 'NOT_GRANTED'\n});\n\nconst DEFAULT_PROBE_TIMEOUT_MS = 15_000;`,
    'audit-timeout-constant'
  );

  audit = replaceOnce(
    audit,
    `async function safeProbe(name, fn) {\n  try {\n    const value = await fn();\n    return Object.freeze({ name, ok: true, value, error: null });\n  } catch (error) {\n    return Object.freeze({ name, ok: false, value: null, error: errorCode(error) });\n  }\n}`,
    `async function safeProbe(name, fn, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {\n  let timer = null;\n  try {\n    const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS);\n    const value = await Promise.race([\n      Promise.resolve().then(fn),\n      new Promise((_, reject) => {\n        timer = setTimeout(() => {\n          const error = new Error('SELF_AUDIT_PROBE_TIMEOUT');\n          error.code = 'SELF_AUDIT_PROBE_TIMEOUT';\n          reject(error);\n        }, timeout);\n      })\n    ]);\n    return Object.freeze({ name, ok: true, value, error: null });\n  } catch (error) {\n    return Object.freeze({ name, ok: false, value: null, error: errorCode(error) });\n  } finally {\n    if (timer) clearTimeout(timer);\n  }\n}`,
    'safeProbe'
  );

  audit = replaceOnce(
    audit,
    `  const [production, waha, customers, quotations, priceAuthorizations, logisticsRules, family, sellers, providers] = await Promise.all([\n    safeProbe('production', () => deps.readProductionAudit()),\n    safeProbe('waha', () => deps.readWahaSession()),\n    safeProbe('customers', () => deps.listCustomers()),\n    safeProbe('quotations', () => deps.listQuotations()),\n    safeProbe('priceAuthorizations', () => deps.listPriceAuthorizations()),\n    safeProbe('logisticsRules', () => deps.listLogisticsRules()),\n    safeProbe('family', () => deps.listOwnerFamily()),\n    safeProbe('sellers', () => deps.listOwnerSellers()),\n    safeProbe('providers', () => deps.listOwnerProviders())\n  ]);`,
    `  const probeTimeoutMs = Math.max(1, Number(options.probeTimeoutMs) || DEFAULT_PROBE_TIMEOUT_MS);\n  const [production, waha, customers, quotations, priceAuthorizations, logisticsRules, family, sellers, providers] = await Promise.all([\n    safeProbe('production', () => deps.readProductionAudit(), probeTimeoutMs),\n    safeProbe('waha', () => deps.readWahaSession(), probeTimeoutMs),\n    safeProbe('customers', () => deps.listCustomers(), probeTimeoutMs),\n    safeProbe('quotations', () => deps.listQuotations(), probeTimeoutMs),\n    safeProbe('priceAuthorizations', () => deps.listPriceAuthorizations(), probeTimeoutMs),\n    safeProbe('logisticsRules', () => deps.listLogisticsRules(), probeTimeoutMs),\n    safeProbe('family', () => deps.listOwnerFamily(), probeTimeoutMs),\n    safeProbe('sellers', () => deps.listOwnerSellers(), probeTimeoutMs),\n    safeProbe('providers', () => deps.listOwnerProviders(), probeTimeoutMs)\n  ]);`,
    'probe-calls'
  );
}
write(auditPath, audit);

const monitorPath = 'services/elanSelfAuditMonitorService.js';
let monitor = read(monitorPath);
if (!monitor.includes('ELAN_SELF_AUDIT_MONITOR_STARTED')) {
  monitor = replaceOnce(
    monitor,
    `  const intervalMs = positiveInteger(env.ELAN_SELF_AUDIT_INTERVAL_MS, DEFAULT_INTERVAL_MS);\n  const initialDelayMs = positiveInteger(env.ELAN_SELF_AUDIT_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);\n  const runner = async () => {\n    try {\n      const result = await runTrackedSelfAudit({ ...options, source: 'scheduled-monitor' });\n      console.log('[ELAN_SELF_AUDIT]', {\n        available: result.report?.summary?.available || 0,\n        degraded: result.report?.summary?.degraded || 0,\n        unavailable: result.report?.summary?.unavailable || 0,\n        changes: result.changes.length,\n        notified: result.notification.sent === true\n      });\n    } catch (error) {\n      console.error('[ELAN_SELF_AUDIT_FAILED]', { code: error?.code || null, message: error?.message || String(error) });\n    }\n  };`,
    `  const intervalMs = positiveInteger(env.ELAN_SELF_AUDIT_INTERVAL_MS, DEFAULT_INTERVAL_MS);\n  const initialDelayMs = positiveInteger(env.ELAN_SELF_AUDIT_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);\n  console.log('[ELAN_SELF_AUDIT_MONITOR_STARTED]', { intervalMs, initialDelayMs });\n  const runner = async () => {\n    const startedAt = Date.now();\n    console.log('[ELAN_SELF_AUDIT_RUN_START]', { source: 'scheduled-monitor' });\n    try {\n      const result = await runTrackedSelfAudit({ ...options, source: 'scheduled-monitor' });\n      console.log('[ELAN_SELF_AUDIT]', {\n        available: result.report?.summary?.available || 0,\n        degraded: result.report?.summary?.degraded || 0,\n        unavailable: result.report?.summary?.unavailable || 0,\n        changes: result.changes.length,\n        notified: result.notification.sent === true,\n        elapsedMs: Date.now() - startedAt\n      });\n    } catch (error) {\n      console.error('[ELAN_SELF_AUDIT_FAILED]', {\n        code: error?.code || null,\n        message: error?.message || String(error),\n        elapsedMs: Date.now() - startedAt\n      });\n    }\n  };`,
    'monitor-runner'
  );
}
write(monitorPath, monitor);

const testPath = 'tests/elanSelfAuditService.test.js';
let tests = read(testPath);
if (!tests.includes('bounded probe timeout')) {
  tests += `\n\ntest('self-audit converts a hanging authority into UNAVAILABLE after bounded probe timeout', async () => {\n  const report = await runElanSelfAudit(successfulOptions({\n    probeTimeoutMs: 20,\n    listCustomersImpl: async () => new Promise(() => {})\n  }));\n\n  const customerRead = report.capabilities.find((item) => item.id === 'business.customer.read');\n  assert.equal(customerRead.status, STATUS.UNAVAILABLE);\n  assert.equal(customerRead.reason, 'SELF_AUDIT_PROBE_TIMEOUT');\n  assert.ok(report.probeErrors.some(item => item.probe === 'customers' && item.error === 'SELF_AUDIT_PROBE_TIMEOUT'));\n});\n`;
}
write(testPath, tests);
