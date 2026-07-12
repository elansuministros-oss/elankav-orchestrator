'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OFFICIAL_ROOTS = Object.freeze(['docs', 'knowledge']);

function normalizeDocumentId(documentId) {
  const value = String(documentId || '').trim().replaceAll('\\', '/');

  if (!value || path.posix.isAbsolute(value) || value.includes('\0')) {
    throw Object.assign(new Error('Documento no autorizado'), {
      code: 'KNOWLEDGE_DOCUMENT_DENIED'
    });
  }

  const normalized = path.posix.normalize(value);
  const root = normalized.split('/')[0];

  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    !OFFICIAL_ROOTS.includes(root) ||
    path.posix.extname(normalized).toLowerCase() !== '.md'
  ) {
    throw Object.assign(new Error('Documento no autorizado'), {
      code: 'KNOWLEDGE_DOCUMENT_DENIED'
    });
  }

  return normalized;
}

function resolveOfficialDocument(documentId, repositoryRoot = process.cwd()) {
  const normalized = normalizeDocumentId(documentId);
  const rootName = normalized.split('/')[0];
  const allowedRoot = fs.realpathSync(path.join(repositoryRoot, rootName));
  const candidate = path.join(repositoryRoot, ...normalized.split('/'));

  if (!fs.existsSync(candidate)) {
    throw Object.assign(new Error('Documento no encontrado'), {
      code: 'KNOWLEDGE_DOCUMENT_NOT_FOUND'
    });
  }

  const stats = fs.lstatSync(candidate);

  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw Object.assign(new Error('Documento no autorizado'), {
      code: 'KNOWLEDGE_DOCUMENT_DENIED'
    });
  }

  const realCandidate = fs.realpathSync(candidate);
  const allowedPrefix = `${allowedRoot}${path.sep}`;

  if (realCandidate !== allowedRoot && !realCandidate.startsWith(allowedPrefix)) {
    throw Object.assign(new Error('Documento no autorizado'), {
      code: 'KNOWLEDGE_DOCUMENT_DENIED'
    });
  }

  return {
    id: normalized,
    absolutePath: realCandidate,
    root: rootName
  };
}

function walkMarkdownFiles(directory, repositoryRoot, output) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      walkMarkdownFiles(absolute, repositoryRoot, output);
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
      output.push(path.relative(repositoryRoot, absolute).split(path.sep).join('/'));
    }
  }
}

function listOfficialDocuments(repositoryRoot = process.cwd()) {
  const documents = [];

  for (const rootName of OFFICIAL_ROOTS) {
    const rootPath = path.join(repositoryRoot, rootName);

    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      continue;
    }

    walkMarkdownFiles(rootPath, repositoryRoot, documents);
  }

  return documents.sort();
}

function readOfficialDocument(documentId, repositoryRoot = process.cwd()) {
  const resolved = resolveOfficialDocument(documentId, repositoryRoot);
  const stats = fs.statSync(resolved.absolutePath);

  return {
    id: resolved.id,
    root: resolved.root,
    content: fs.readFileSync(resolved.absolutePath, 'utf8'),
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString()
  };
}

module.exports = {
  OFFICIAL_ROOTS,
  listOfficialDocuments,
  normalizeDocumentId,
  readOfficialDocument,
  resolveOfficialDocument
};
