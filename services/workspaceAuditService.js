'use strict';

const { randomUUID } = require('node:crypto');

function createAuditEvent({ requestId, actor, capability, workspaceId, resource, decision, result, durationMs }) {
  const event = Object.freeze({
    eventId: randomUUID(),
    requestId,
    actorId: actor?.id || 'unknown',
    actorType: actor?.type || 'unknown',
    channel: actor?.channel || null,
    capability,
    workspaceId: workspaceId || null,
    resource: resource || null,
    decision,
    result,
    durationMs,
    timestamp: new Date().toISOString()
  });
  console.info('[WORKSPACE_AUDIT]', JSON.stringify(event));
  return event;
}

module.exports = { createAuditEvent };
