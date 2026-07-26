'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const policy = require('../config/workspace-intelligence.json');

function workspaceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeRelativePath(value = '') {
  const normalized = String(value).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.includes('\0')) {
    throw workspaceError('WORKSPACE_PATH_INVALID', 'Ruta de workspace inválida');
  }
  const safe = path.posix.normalize(normalized);
  if (safe === '..' || safe.startsWith('../')) {
    throw workspaceError('WORKSPACE_PATH_DENIED', 'La ruta solicitada no está permitida');
  }
  return safe;
}

function isBlocked(relativePath) {
  const normalized = String(relativePath).replace(/\\/g, '/');
  const basename = path.posix.basename(normalized);
  if (policy.blockedNames.includes(normalized) || policy.blockedNames.includes(basename)) return true;
  return policy.blockedPatterns.some(pattern => new RegExp(pattern, 'i').test(normalized));
}

function assertAllowedTextPath(relativePath) {
  const safe = normalizeRelativePath(relativePath);
  if (isBlocked(safe)) {
    throw workspaceError('WORKSPACE_RESOURCE_BLOCKED', 'El recurso solicitado está bloqueado');
  }
  const extension = path.extname(safe).toLowerCase();
  if (!policy.allowedExtensions.includes(extension)) {
    throw workspaceError('WORKSPACE_FILE_TYPE_DENIED', 'Tipo de archivo no permitido');
  }
  return safe;
}

async function resolveInside(root, relativePath) {
  const rootReal = await fs.realpath(root);
  const safe = normalizeRelativePath(relativePath);
  const candidate = path.resolve(rootReal, safe);
  const candidateReal = await fs.realpath(candidate);
  if (candidateReal !== rootReal && !candidateReal.startsWith(`${rootReal}${path.sep}`)) {
    throw workspaceError('WORKSPACE_PATH_DENIED', 'La ruta escapa del workspace');
  }
  return { rootReal, candidateReal, relativePath: safe };
}

function assertTextBuffer(buffer) {
  if (buffer.includes(0)) {
    throw workspaceError('WORKSPACE_BINARY_DENIED', 'Los archivos binarios no están permitidos');
  }
}

function redactSecrets(text) {
  return String(text)
    .replace(/((?:token|secret|password|api[_-]?key)\s*[:=]\s*)[^\s'"`]+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED_KEY]');
}

module.exports = {
  policy,
  workspaceError,
  normalizeRelativePath,
  assertAllowedTextPath,
  resolveInside,
  assertTextBuffer,
  redactSecrets,
  isBlocked
};
