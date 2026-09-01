'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getCapability, resolveService } = require('./ownerOpsCapabilityRegistry');
const {
  loadPendingOperation,
  markOperationCompleted,
  markOperationFailed,
  markOperationRunning
} = require('./ownerOpsConfirmationService');
const { publishPreparedJob } = require('./ownerOpsCodePublishService');
const { enqueueSupervisorOperation, readSupervisorResult } = require('./ownerOpsSupervisorClient');
const {
  applyPayment,
  createPriceAuthorization,
  createWorkOrder,
  revokePriceAuthorization,
  sendQuotationWhatsApp
} = require('./ownerBusinessConnectClient');
const { recordAuditSafely } = require('./ownerOpsAuditService');

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 512 * 1024;

async function runCommand(file, args, options = {}) {
  const result = await execFileAsync(file, args, {
    env: process.env,
    timeout: options.timeout || 30_000,
    maxBuffer: MAX_BUFFER
  });
  return { stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

async function runPrivilegedSystemctl(args) {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  return isRoot ? runCommand('systemctl', args) : runCommand('sudo', ['-n', 'systemctl', ...args]);
}

async function restartService(target) {
  const service = resolveService(target);
  if (!service) throw Object.assign(new Error('OWNER_OPS_TARGET_NOT_ALLOWED'), { code: 'OWNER_OPS_TARGET_NOT_ALLOWED' });
  await runPrivilegedSystemctl(['restart', service]);
  const status = await runCommand('systemctl', ['is-active', service]);
  if (status.stdout !== 'active') throw Object.assign(new Error('OWNER_OPS_SERVICE_NOT_ACTIVE_AFTER_RESTART'), { code: 'OWNER_OPS_SERVICE_NOT_ACTIVE_AFTER_RESTART' });
  return { capability: 'service.restart', target, service, status: status.stdout, success: true };
}

async function delegateToSupervisor(id, operation) {
  const request = await enqueueSupervisorOperation({
    id,
    capability: operation.capability,
    target: operation.target,
    parameters: operation.parameters || {},
    executeAfterMs: 2000
  });
  return { capability: 'supervisor.delegated', delegatedCapability: operation.capability, target: operation.target, executeAfter: request.executeAfter, status: 'queued' };
}

async function executeBusinessSensitive(operation) {
  const parameters = operation.parameters || {};
  const projectId = String(parameters.projectId || '').trim();

  if (operation.capability === 'business.quotation.send-whatsapp') {
    if (!projectId) throw Object.assign(new Error('PROJECT_ID_REQUIRED'), { code: 'PROJECT_ID_REQUIRED' });
    const result = await sendQuotationWhatsApp(projectId, parameters.delivery || {});
    return {
      capability: operation.capability,
      target: 'connect',
      projectId,
      quotationId: result.quotationId || null,
      quotationNumber: result.quotationNumber || null,
      publicUrl: result.publicUrl || null,
      messageId: result.messageId || null,
      success: true
    };
  }

  if (operation.capability === 'business.payment.apply') {
    if (!projectId) throw Object.assign(new Error('PROJECT_ID_REQUIRED'), { code: 'PROJECT_ID_REQUIRED' });
    if (!parameters.payment || typeof parameters.payment !== 'object') throw Object.assign(new Error('PAYMENT_PAYLOAD_REQUIRED'), { code: 'PAYMENT_PAYLOAD_REQUIRED' });
    const paymentResult = await applyPayment(projectId, parameters.payment);
    const payment = paymentResult.data || paymentResult;
    let workOrder = null;
    if (parameters.createWorkOrder === true) {
      const workOrderResult = await createWorkOrder(projectId, parameters.workOrder || {});
      workOrder = workOrderResult.data || workOrderResult;
    }
    return {
      capability: operation.capability,
      target: 'connect',
      projectId,
      paymentId: payment.id || null,
      receiptNumber: payment.receiptNumber || null,
      workOrderId: workOrder?.id || null,
      workOrderNumber: workOrder?.workOrderNumber || null,
      success: true
    };
  }

  if (operation.capability === 'business.price-authorization.create') {
    if (!parameters.authorization || typeof parameters.authorization !== 'object') throw Object.assign(new Error('PRICE_AUTH_PAYLOAD_REQUIRED'), { code: 'PRICE_AUTH_PAYLOAD_REQUIRED' });
    const result = await createPriceAuthorization(parameters.authorization);
    const authorization = result.data || result;
    return {
      capability: operation.capability,
      target: 'connect',
      authorizationId: authorization.id || null,
      authorizationCode: authorization.authorizationCode || null,
      sellerId: authorization.sellerId || null,
      price: authorization.price ?? null,
      currency: authorization.currency || null,
      success: true
    };
  }

  if (operation.capability === 'business.price-authorization.revoke') {
    const authorizationId = String(parameters.authorizationId || '').trim();
    if (!authorizationId) throw Object.assign(new Error('PRICE_AUTH_ID_REQUIRED'), { code: 'PRICE_AUTH_ID_REQUIRED' });
    const result = await revokePriceAuthorization(authorizationId);
    const authorization = result.data || result;
    return {
      capability: operation.capability,
      target: 'connect',
      authorizationId: authorization.id || authorizationId,
      authorizationCode: authorization.authorizationCode || null,
      status: authorization.status || 'revoked',
      success: true
    };
  }

  throw Object.assign(new Error('OWNER_OPS_SENSITIVE_CAPABILITY_NOT_IMPLEMENTED'), { code: 'OWNER_OPS_SENSITIVE_CAPABILITY_NOT_IMPLEMENTED' });
}

async function executeConfirmedOperation(id) {
  const { operation } = await loadPendingOperation(id);
  const capability = getCapability(operation.capability);
  if (!capability || capability.risk !== 'CONFIRM_REQUIRED') throw Object.assign(new Error('OWNER_OPS_CAPABILITY_NOT_CONFIRMABLE'), { code: 'OWNER_OPS_CAPABILITY_NOT_CONFIRMABLE' });

  const running = await markOperationRunning(id);
  try {
    const requiresSupervisor = (operation.capability === 'service.restart' && operation.target === 'orchestrator') || operation.capability === 'repository.deploy';
    if (requiresSupervisor) {
      const execution = await delegateToSupervisor(id, operation);
      return { job: running, execution, deferred: true };
    }

    let execution;
    if (operation.capability === 'service.restart') execution = await restartService(operation.target);
    else if (operation.capability === 'git.publish-prepared') {
      const jobId = String(operation.parameters?.jobId || '').trim();
      if (!jobId) throw Object.assign(new Error('PREPARED_JOB_ID_REQUIRED'), { code: 'PREPARED_JOB_ID_REQUIRED' });
      execution = await publishPreparedJob(jobId);
    } else if (operation.capability.startsWith('business.')) execution = await executeBusinessSensitive(operation);
    else throw Object.assign(new Error('OWNER_OPS_SENSITIVE_CAPABILITY_NOT_IMPLEMENTED'), { code: 'OWNER_OPS_SENSITIVE_CAPABILITY_NOT_IMPLEMENTED' });

    await recordAuditSafely({
      capability: operation.capability,
      target: operation.target || execution.target || null,
      source: 'owner-whatsapp',
      success: true,
      metadata: {
        operationId: id,
        projectId: execution.projectId || null,
        quotationId: execution.quotationId || null,
        paymentId: execution.paymentId || null,
        workOrderId: execution.workOrderId || null,
        authorizationId: execution.authorizationId || null
      }
    });

    const completed = await markOperationCompleted(id, execution);
    return { job: completed, execution };
  } catch (cause) {
    await recordAuditSafely({ capability: operation.capability, target: operation.target || null, source: 'owner-whatsapp', success: false, errorCode: cause?.code || cause?.message || 'OWNER_OPS_FAILED', metadata: { operationId: id } });
    return markOperationFailed(id, cause);
  }
}

async function readDeferredOperationResult(id) {
  const result = await readSupervisorResult(id);
  if (!result) return { id, status: 'pending', execution: null };
  if (result.status === 'completed') {
    const job = await markOperationCompleted(id, result.execution);
    return { id, status: 'completed', execution: result.execution, job };
  }
  const error = new Error(result.error || 'SUPERVISOR_OPERATION_FAILED');
  error.code = result.error || 'SUPERVISOR_OPERATION_FAILED';
  try { await markOperationFailed(id, error); } catch (_) {}
  return { id, status: 'failed', error: error.code, execution: null };
}

function formatSensitiveResult(result) {
  const execution = result?.execution;
  if (!execution) return 'La operación no devolvió resultado verificable.';
  if (execution.capability === 'supervisor.delegated') return ['✅ Operación autorizada y delegada al supervisor externo.', '', `Operación: ${result.job.id}`, `Objetivo: ${execution.target}`, `Acción: ${execution.delegatedCapability}`, `Ejecución programada: ${execution.executeAfter}`, '', 'El supervisor ejecutará la acción fuera del proceso del Orchestrator.', `Después podés consultar: ELAN estado ${result.job.id}`].join('\n');
  if (execution.capability === 'service.restart') return ['✅ Operación sensible completada.', '', `Operación: ${result.job.id}`, `Servicio: ${execution.service}`, `Estado verificado: ${execution.status}`].join('\n');
  if (execution.capability === 'git.publish-prepared') return ['✅ Corrección preparada publicada.', '', `Operación: ${result.job.id}`, `Job preparado: ${execution.jobId}`, `Rama: ${execution.branch}`, `Commit: ${execution.commitSha || 'creado'}`, `Pull Request: ${execution.pullRequestUrl || 'creado'}`, '', 'No se realizó merge ni deploy.'].join('\n');
  if (execution.capability === 'business.quotation.send-whatsapp') return ['✅ Cotización enviada por WhatsApp.', '', `Operación: ${result.job.id}`, `Cotización: ${execution.quotationNumber || execution.quotationId || 'verificada'}`, execution.publicUrl ? `Enlace: ${execution.publicUrl}` : '', `Proyecto: ${execution.projectId}`].filter(Boolean).join('\n');
  if (execution.capability === 'business.payment.apply') return ['✅ Pago registrado en CONNECT.', '', `Operación: ${result.job.id}`, execution.receiptNumber ? `Recibo: ${execution.receiptNumber}` : `Pago: ${execution.paymentId || 'registrado'}`, execution.workOrderNumber ? `OT: ${execution.workOrderNumber}` : '', `Proyecto: ${execution.projectId}`].filter(Boolean).join('\n');
  if (execution.capability === 'business.price-authorization.create') return ['✅ Precio excepcional autorizado.', '', `Operación: ${result.job.id}`, `Autorización: ${execution.authorizationCode || execution.authorizationId}`, `Vendedor: ${execution.sellerId}`, `Precio: ${execution.currency || 'USD'} ${Number(execution.price || 0).toFixed(2)}`].join('\n');
  if (execution.capability === 'business.price-authorization.revoke') return ['✅ Autorización de precio revocada.', '', `Operación: ${result.job.id}`, `Autorización: ${execution.authorizationCode || execution.authorizationId}`, `Estado: ${execution.status}`].join('\n');
  return `✅ Operación ${result.job.id} completada.`;
}

module.exports = {
  delegateToSupervisor,
  executeBusinessSensitive,
  executeConfirmedOperation,
  formatSensitiveResult,
  readDeferredOperationResult,
  restartService,
  runCommand,
  runPrivilegedSystemctl
};
