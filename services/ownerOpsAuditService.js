'use strict';

const crypto = require('node:crypto');
const { addJob } = require('./jobs/jobQueue');

function createAuditId(now = Date.now()) {
  return `AUDIT-${now}-${crypto.randomUUID().slice(0, 8)}`;
}

async function recordAudit({
  capability,
  target = null,
  source = 'owner-whatsapp',
  success = true,
  errorCode = null,
  metadata = {}
}) {
  const now = new Date().toISOString();
  const entry = {
    id: createAuditId(),
    type: 'owner_ops_audit',
    platform: 'elankav',
    task: capability || 'unknown',
    branch: null,
    status: success ? 'completed' : 'failed',
    steps: [],
    result: {
      audit: {
        capability: capability || null,
        target,
        source,
        success: Boolean(success),
        errorCode: errorCode || null,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        // Deliberately metadata-only. stdout/stderr, secrets and message bodies
        // must never be persisted by this audit service.
        outputPersisted: false,
        createdAt: now
      }
    },
    error: success ? null : (errorCode || 'OWNER_OPS_FAILED'),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now
  };

  return addJob(entry);
}

async function recordAuditSafely(input) {
  try {
    return await recordAudit(input);
  } catch (error) {
    console.error('[OWNER_OPS_AUDIT_WRITE_FAILED]', {
      capability: input?.capability || null,
      target: input?.target || null,
      code: error?.code || error?.message || 'UNKNOWN'
    });
    return null;
  }
}

module.exports = {
  createAuditId,
  recordAudit,
  recordAuditSafely
};
