'use strict';

const { randomUUID } = require('node:crypto');
const { executeWorkspaceCapability } = require('./workspaceIntelligenceService');
const { createAuditEvent } = require('./workspaceAuditService');

const ENABLED = new Set([
  'workspace.list', 'workspace.inspect', 'workspace.gitStatus', 'workspace.search',
  'workspace.read', 'workspace.diff', 'workspace.packageManifest'
]);

function validateRequest(request) {
  if (!request || typeof request !== 'object') throw Object.assign(new Error('Solicitud requerida'), { code: 'VALIDATION_ERROR' });
  if (!request.capability || typeof request.capability !== 'string') throw Object.assign(new Error('Capability requerida'), { code: 'VALIDATION_ERROR' });
  if (!request.actor?.id) throw Object.assign(new Error('Actor requerido'), { code: 'VALIDATION_ERROR' });
  if (request.capability !== 'workspace.list' && !request.input?.workspaceId) {
    throw Object.assign(new Error('workspaceId requerido'), { code: 'VALIDATION_ERROR' });
  }
}

async function invokeWorkspaceTool(request) {
  const startedAt = Date.now();
  const requestId = request?.requestId || randomUUID();
  let audit;
  try {
    validateRequest(request);
    if (!ENABLED.has(request.capability)) {
      const code = request.capability.startsWith('workspace.') ? 'CAPABILITY_NOT_ENABLED' : 'CAPABILITY_UNKNOWN';
      throw Object.assign(new Error('Capability no habilitada'), { code });
    }
    const data = await executeWorkspaceCapability(request.capability, request.input || {});
    audit = createAuditEvent({ requestId, actor: request.actor, capability: request.capability, workspaceId: request.input?.workspaceId, resource: request.input?.path, decision: 'allowed', result: 'success', durationMs: Date.now() - startedAt });
    return { success: true, requestId, capability: request.capability, data, audit: { eventId: audit.eventId, timestamp: audit.timestamp } };
  } catch (error) {
    audit = createAuditEvent({ requestId, actor: request?.actor, capability: request?.capability || null, workspaceId: request?.input?.workspaceId, resource: request?.input?.path, decision: error.code === 'CAPABILITY_NOT_ENABLED' ? 'denied' : 'allowed', result: error.code || 'WORKSPACE_ERROR', durationMs: Date.now() - startedAt });
    return { success: false, requestId, capability: request?.capability || null, error: { code: error.code || 'WORKSPACE_ERROR', message: error.message }, audit: { eventId: audit.eventId, timestamp: audit.timestamp } };
  }
}

module.exports = { ENABLED, invokeWorkspaceTool };
