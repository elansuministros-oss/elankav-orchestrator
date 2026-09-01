'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createWahaDeliveryAdapter, normalizePhone } = require('../adapters/wahaDeliveryAdapter');
const { runElanSelfAudit } = require('./elanSelfAuditService');

const DEFAULT_STATE_PATH = '/var/lib/elankav/orchestrator/elan-self-audit-state.json';
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 2 * 60 * 1000;

let monitorTimer = null;
let initialTimer = null;
let monitorRunning = false;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function resolveStatePath(env = process.env) {
  return String(env.ELAN_SELF_AUDIT_STATE_PATH || DEFAULT_STATE_PATH).trim() || DEFAULT_STATE_PATH;
}

function configuredOwnerPhone(env = process.env) {
  return normalizePhone(
    env.ELAN_SELF_AUDIT_OWNER_PHONE ||
    env.ELANKAV_OWNER_WHATSAPP ||
    env.OWNER_WHATSAPP_PHONE ||
    env.OWNER_PHONE ||
    ''
  );
}

function snapshotReport(report) {
  const capabilities = {};
  for (const item of report?.capabilities || []) {
    if (!item?.id) continue;
    capabilities[item.id] = {
      status: item.status || 'UNAVAILABLE',
      reason: item.reason || null
    };
  }

  const diagnostics = report?.diagnostics || {};
  return {
    generatedAt: report?.generatedAt || new Date().toISOString(),
    capabilities,
    diagnostics: {
      production: diagnostics.production || 'UNAVAILABLE',
      waha: diagnostics.waha || 'UNAVAILABLE',
      sellers: diagnostics.sellers || 'UNAVAILABLE',
      providers: diagnostics.providers || 'UNAVAILABLE',
      registryComplete: diagnostics.registryComplete !== false,
      registryGapCount: Number(diagnostics.registryGapCount || 0)
    },
    summary: {
      total: Number(report?.summary?.total || 0),
      available: Number(report?.summary?.available || 0),
      degraded: Number(report?.summary?.degraded || 0),
      unavailable: Number(report?.summary?.unavailable || 0),
      operationalPercent: Number(report?.summary?.operationalPercent || 0)
    }
  };
}

function statusKind(from, to) {
  if (from === to) return null;
  if (to === 'UNAVAILABLE') return 'REGRESSION';
  if (from === 'AVAILABLE' && to === 'DEGRADED') return 'REGRESSION';
  if ((from === 'UNAVAILABLE' || from === 'DEGRADED') && to === 'AVAILABLE') return 'RECOVERY';
  if (from === 'UNAVAILABLE' && to === 'DEGRADED') return 'RECOVERY';
  return 'CHANGE';
}

function compareSnapshots(previous, current) {
  if (!previous || !current) return [];
  const changes = [];
  const ids = new Set([
    ...Object.keys(previous.capabilities || {}),
    ...Object.keys(current.capabilities || {})
  ]);

  for (const id of ids) {
    const before = previous.capabilities?.[id]?.status || null;
    const after = current.capabilities?.[id]?.status || null;
    if (!before || !after || before === after) continue;
    const kind = statusKind(before, after);
    if (!kind) continue;
    changes.push({
      type: 'capability',
      id,
      from: before,
      to: after,
      kind,
      reason: current.capabilities?.[id]?.reason || null
    });
  }

  for (const key of ['production', 'waha', 'sellers', 'providers']) {
    const before = previous.diagnostics?.[key] || null;
    const after = current.diagnostics?.[key] || null;
    if (!before || !after || before === after) continue;
    changes.push({ type: 'diagnostic', id: key, from: before, to: after, kind: statusKind(before, after) || 'CHANGE', reason: null });
  }

  if (previous.diagnostics?.registryComplete !== current.diagnostics?.registryComplete) {
    changes.push({
      type: 'registry',
      id: 'capability-registry',
      from: previous.diagnostics?.registryComplete === false ? 'INCOMPLETE' : 'COMPLETE',
      to: current.diagnostics?.registryComplete === false ? 'INCOMPLETE' : 'COMPLETE',
      kind: current.diagnostics?.registryComplete === false ? 'REGRESSION' : 'RECOVERY',
      reason: current.diagnostics?.registryComplete === false ? 'REGISTRY_GAP' : null
    });
  }

  return changes;
}

function formatChangeNotification(report, changes) {
  const regressions = changes.filter(item => item.kind === 'REGRESSION');
  const recoveries = changes.filter(item => item.kind === 'RECOVERY');
  const title = regressions.length ? '🚨 ELAN SELF-AUDIT — CAMBIO OPERATIVO' : '✅ ELAN SELF-AUDIT — RECUPERACIÓN';
  const selected = [...regressions, ...recoveries, ...changes.filter(item => !['REGRESSION', 'RECOVERY'].includes(item.kind))].slice(0, 12);

  return [
    title,
    '',
    ...selected.map(item => `- ${item.id}: ${item.from} → ${item.to}${item.reason ? ` (${item.reason})` : ''}`),
    '',
    `AVAILABLE: ${report?.summary?.available || 0}/${report?.summary?.total || 0}`,
    `DEGRADED: ${report?.summary?.degraded || 0}`,
    `UNAVAILABLE: ${report?.summary?.unavailable || 0}`,
    `Cobertura verificada: ${report?.summary?.operationalPercent || 0}%`,
    '',
    'La auditoría fue READ-ONLY. No se ejecutaron escrituras.'
  ].join('\n');
}

async function loadState(statePath = DEFAULT_STATE_PATH) {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveState(state, statePath = DEFAULT_STATE_PATH) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temp = `${statePath}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, statePath);
  await fs.chmod(statePath, 0o600).catch(() => {});
}

async function deliverNotification({ phone, text, delivery }) {
  const target = normalizePhone(phone);
  if (!target) return { sent: false, reason: 'OWNER_NOTIFICATION_TARGET_NOT_CONFIGURED' };
  const adapter = delivery || createWahaDeliveryAdapter();
  const result = await adapter.sendText({ phone: target, text });
  return { sent: true, reason: null, messageId: result?.messageId || null };
}

async function runTrackedSelfAudit(options = {}) {
  const env = options.env || process.env;
  const statePath = options.statePath || resolveStatePath(env);
  const auditFn = options.runElanSelfAuditImpl || runElanSelfAudit;
  const previousState = await (options.loadStateImpl || loadState)(statePath);
  const report = await auditFn(options.auditOptions || {});
  const snapshot = snapshotReport(report);
  const manual = options.source === 'owner-command';
  const priorComparable = previousState.lastNotifiedSnapshot || previousState.lastSnapshot || null;
  const changes = compareSnapshots(priorComparable, snapshot);
  const ownerPhone = normalizePhone(options.ownerPhone) || previousState.ownerPhone || configuredOwnerPhone(env) || null;
  let notification = { sent: false, reason: 'NO_SIGNIFICANT_CHANGE' };
  let lastNotifiedSnapshot = previousState.lastNotifiedSnapshot || previousState.lastSnapshot || null;
  let lastNotifiedAt = previousState.lastNotifiedAt || null;

  if (manual) {
    lastNotifiedSnapshot = snapshot;
    lastNotifiedAt = new Date().toISOString();
    notification = { sent: false, reason: 'MANUAL_AUDIT_ACKNOWLEDGED' };
  } else if (changes.length) {
    try {
      notification = await (options.deliverNotificationImpl || deliverNotification)({
        phone: ownerPhone,
        text: formatChangeNotification(report, changes),
        delivery: options.delivery
      });
      if (notification.sent) {
        lastNotifiedSnapshot = snapshot;
        lastNotifiedAt = new Date().toISOString();
      }
    } catch (error) {
      notification = { sent: false, reason: String(error?.code || error?.message || 'OWNER_NOTIFICATION_FAILED') };
    }
  } else if (!lastNotifiedSnapshot) {
    lastNotifiedSnapshot = snapshot;
    lastNotifiedAt = new Date().toISOString();
    notification = { sent: false, reason: 'INITIAL_BASELINE' };
  }

  const state = {
    version: 1,
    ownerPhone,
    lastRunAt: new Date().toISOString(),
    lastSnapshot: snapshot,
    lastNotifiedSnapshot,
    lastNotifiedAt,
    lastNotification: notification,
    lastChangeCount: changes.length
  };

  await (options.saveStateImpl || saveState)(state, statePath);
  return { report, changes, notification, statePath };
}

function startElanSelfAuditMonitor(options = {}) {
  if (monitorRunning) return { started: false, reason: 'ALREADY_RUNNING' };
  monitorRunning = true;
  const env = options.env || process.env;
  const intervalMs = positiveInteger(env.ELAN_SELF_AUDIT_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  const initialDelayMs = positiveInteger(env.ELAN_SELF_AUDIT_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);
  const runner = async () => {
    try {
      const result = await runTrackedSelfAudit({ ...options, source: 'scheduled-monitor' });
      console.log('[ELAN_SELF_AUDIT]', {
        available: result.report?.summary?.available || 0,
        degraded: result.report?.summary?.degraded || 0,
        unavailable: result.report?.summary?.unavailable || 0,
        changes: result.changes.length,
        notified: result.notification.sent === true
      });
    } catch (error) {
      console.error('[ELAN_SELF_AUDIT_FAILED]', { code: error?.code || null, message: error?.message || String(error) });
    }
  };

  initialTimer = setTimeout(() => {
    void runner();
    monitorTimer = setInterval(() => { void runner(); }, intervalMs);
    if (typeof monitorTimer.unref === 'function') monitorTimer.unref();
  }, initialDelayMs);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();

  return { started: true, intervalMs, initialDelayMs };
}

function stopElanSelfAuditMonitor() {
  if (initialTimer) clearTimeout(initialTimer);
  if (monitorTimer) clearInterval(monitorTimer);
  initialTimer = null;
  monitorTimer = null;
  monitorRunning = false;
}

module.exports = {
  DEFAULT_STATE_PATH,
  compareSnapshots,
  configuredOwnerPhone,
  deliverNotification,
  formatChangeNotification,
  loadState,
  resolveStatePath,
  runTrackedSelfAudit,
  saveState,
  snapshotReport,
  startElanSelfAuditMonitor,
  stopElanSelfAuditMonitor
};
