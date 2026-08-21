'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  compareSnapshots,
  runTrackedSelfAudit,
  snapshotReport,
  startElanSelfAuditMonitor,
  stopElanSelfAuditMonitor
} = require('../services/elanSelfAuditMonitorService');

function report(status = 'AVAILABLE') {
  return {
    generatedAt: '2026-08-21T00:00:00.000Z',
    summary: { total: 2, available: status === 'AVAILABLE' ? 2 : 1, degraded: status === 'DEGRADED' ? 1 : 0, unavailable: status === 'UNAVAILABLE' ? 1 : 0, operationalPercent: status === 'AVAILABLE' ? 100 : 50 },
    diagnostics: { production: 'AVAILABLE', waha: 'AVAILABLE', sellers: 'AVAILABLE', providers: 'AVAILABLE', registryComplete: true, registryGapCount: 0 },
    capabilities: [
      { id: 'business.customer.read', status, reason: status === 'AVAILABLE' ? null : 'SIMULATED' },
      { id: 'business.quotation.read', status: 'AVAILABLE', reason: null }
    ]
  };
}

test('detects a regression and recovery without writes', () => {
  const before = snapshotReport(report('AVAILABLE'));
  const down = snapshotReport(report('UNAVAILABLE'));
  const restored = snapshotReport(report('AVAILABLE'));

  const regression = compareSnapshots(before, down);
  assert.equal(regression.length, 1);
  assert.equal(regression[0].kind, 'REGRESSION');
  assert.equal(regression[0].id, 'business.customer.read');

  const recovery = compareSnapshots(down, restored);
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0].kind, 'RECOVERY');
});

test('manual self-audit establishes acknowledged baseline and remembers owner target', async () => {
  let saved = null;
  const result = await runTrackedSelfAudit({
    source: 'owner-command',
    ownerPhone: '+50588887777',
    statePath: '/tmp/not-used.json',
    runElanSelfAuditImpl: async () => report('AVAILABLE'),
    loadStateImpl: async () => ({}),
    saveStateImpl: async state => { saved = state; }
  });

  assert.equal(result.notification.reason, 'MANUAL_AUDIT_ACKNOWLEDGED');
  assert.equal(result.notification.sent, false);
  assert.equal(saved.ownerPhone, '50588887777');
  assert.equal(saved.lastNotifiedSnapshot.capabilities['business.customer.read'].status, 'AVAILABLE');
});

test('scheduled regression notifies owner and advances notified baseline only after delivery', async () => {
  const baseline = snapshotReport(report('AVAILABLE'));
  let saved = null;
  let delivered = null;
  const result = await runTrackedSelfAudit({
    source: 'scheduled-monitor',
    ownerPhone: '50588887777',
    statePath: '/tmp/not-used.json',
    runElanSelfAuditImpl: async () => report('UNAVAILABLE'),
    loadStateImpl: async () => ({ ownerPhone: '50588887777', lastSnapshot: baseline, lastNotifiedSnapshot: baseline }),
    deliverNotificationImpl: async input => { delivered = input; return { sent: true, reason: null }; },
    saveStateImpl: async state => { saved = state; }
  });

  assert.equal(result.changes[0].kind, 'REGRESSION');
  assert.equal(result.notification.sent, true);
  assert.match(delivered.text, /CAMBIO OPERATIVO/);
  assert.equal(saved.lastNotifiedSnapshot.capabilities['business.customer.read'].status, 'UNAVAILABLE');
});

test('failed notification leaves previous notified baseline so the alert can retry', async () => {
  const baseline = snapshotReport(report('AVAILABLE'));
  let saved = null;
  const result = await runTrackedSelfAudit({
    source: 'scheduled-monitor',
    ownerPhone: '50588887777',
    statePath: '/tmp/not-used.json',
    runElanSelfAuditImpl: async () => report('UNAVAILABLE'),
    loadStateImpl: async () => ({ ownerPhone: '50588887777', lastSnapshot: baseline, lastNotifiedSnapshot: baseline }),
    deliverNotificationImpl: async () => { throw Object.assign(new Error('WAHA_DOWN'), { code: 'WAHA_DOWN' }); },
    saveStateImpl: async state => { saved = state; }
  });

  assert.equal(result.notification.sent, false);
  assert.equal(result.notification.reason, 'WAHA_DOWN');
  assert.equal(saved.lastNotifiedSnapshot.capabilities['business.customer.read'].status, 'AVAILABLE');
});

test('scheduled monitor timer actually fires the tracked audit runner', async () => {
  let runs = 0;
  stopElanSelfAuditMonitor();

  const started = startElanSelfAuditMonitor({
    env: {
      ELAN_SELF_AUDIT_INITIAL_DELAY_MS: '5',
      ELAN_SELF_AUDIT_INTERVAL_MS: '1000'
    },
    statePath: '/tmp/not-used.json',
    runElanSelfAuditImpl: async () => {
      runs += 1;
      return report('AVAILABLE');
    },
    loadStateImpl: async () => ({}),
    saveStateImpl: async () => {}
  });

  assert.equal(started.started, true);
  await new Promise(resolve => setTimeout(resolve, 60));
  stopElanSelfAuditMonitor();
  assert.ok(runs >= 1, `expected scheduled audit to run at least once, got ${runs}`);
});
