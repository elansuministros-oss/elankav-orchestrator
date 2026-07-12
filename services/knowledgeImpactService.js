'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeDocumentId
} = require('../adapters/knowledgeAdapter');

const IMPACT_STATUS = Object.freeze({
  NO_REQUIERE_CAMBIO: 'NO_REQUIERE_CAMBIO',
  PENDIENTE: 'PENDIENTE',
  ACTUALIZADO: 'ACTUALIZADO'
});

function getStorePath() {
  return process.env.KNOWLEDGE_IMPACT_STORE ||
    '/var/lib/elankav-orchestrator/knowledge-impact.json';
}

function readStore(storePath = getStorePath()) {
  if (!fs.existsSync(storePath)) {
    return [];
  }

  const raw = fs.readFileSync(storePath, 'utf8').trim();

  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function writeStore(records, storePath = getStorePath()) {
  const directory = path.dirname(storePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 });

  const temporaryPath = `${storePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o640
  });
  fs.renameSync(temporaryPath, storePath);
}

function normalizeRequired(value, fieldName) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw Object.assign(new Error(`${fieldName} es obligatorio`), {
      code: 'KNOWLEDGE_IMPACT_INVALID'
    });
  }

  return normalized;
}

function normalizeDocuments(documents) {
  if (!Array.isArray(documents)) {
    throw Object.assign(new Error('documents debe ser una lista'), {
      code: 'KNOWLEDGE_IMPACT_INVALID'
    });
  }

  return [...new Set(documents.map(normalizeDocumentId))].sort();
}

function validateStatus(status) {
  if (!Object.values(IMPACT_STATUS).includes(status)) {
    throw Object.assign(new Error(`Estado documental no soportado: ${status}`), {
      code: 'KNOWLEDGE_IMPACT_INVALID'
    });
  }
}

function recordKnowledgeImpact({
  movementId,
  platform,
  commit = null,
  pullRequest = null,
  documents = [],
  status = IMPACT_STATUS.PENDIENTE
}, storePath = getStorePath()) {
  validateStatus(status);

  const normalizedDocuments = normalizeDocuments(documents);

  if (status === IMPACT_STATUS.PENDIENTE && normalizedDocuments.length === 0) {
    throw Object.assign(
      new Error('Un impacto pendiente requiere documentos afectados'),
      { code: 'KNOWLEDGE_IMPACT_INVALID' }
    );
  }

  const now = new Date().toISOString();
  const record = {
    movementId: normalizeRequired(movementId, 'movementId'),
    platform: normalizeRequired(platform, 'platform'),
    commit: commit ? String(commit).trim() : null,
    pullRequest: pullRequest ? String(pullRequest).trim() : null,
    documents: normalizedDocuments,
    status,
    detectedAt: now,
    closedAt: status === IMPACT_STATUS.ACTUALIZADO ||
      status === IMPACT_STATUS.NO_REQUIERE_CAMBIO
      ? now
      : null
  };

  const records = readStore(storePath)
    .filter(item => item.movementId !== record.movementId);

  records.push(record);
  writeStore(records, storePath);

  return { ...record, documents: [...record.documents] };
}

function listKnowledgeImpacts({ status } = {}, storePath = getStorePath()) {
  if (status) {
    validateStatus(status);
  }

  return readStore(storePath)
    .filter(record => !status || record.status === status)
    .map(record => ({ ...record, documents: [...record.documents] }))
    .sort((left, right) => String(right.detectedAt).localeCompare(
      String(left.detectedAt)
    ));
}

function closeKnowledgeImpact(
  movementId,
  status = IMPACT_STATUS.ACTUALIZADO,
  storePath = getStorePath()
) {
  validateStatus(status);

  if (status === IMPACT_STATUS.PENDIENTE) {
    throw Object.assign(new Error('El cierre no puede quedar pendiente'), {
      code: 'KNOWLEDGE_IMPACT_INVALID'
    });
  }

  const normalizedId = normalizeRequired(movementId, 'movementId');
  const records = readStore(storePath);
  const index = records.findIndex(item => item.movementId === normalizedId);

  if (index < 0) {
    throw Object.assign(new Error('Impacto documental no encontrado'), {
      code: 'KNOWLEDGE_IMPACT_NOT_FOUND'
    });
  }

  records[index] = {
    ...records[index],
    status,
    closedAt: new Date().toISOString()
  };

  writeStore(records, storePath);
  return {
    ...records[index],
    documents: [...records[index].documents]
  };
}

module.exports = {
  IMPACT_STATUS,
  closeKnowledgeImpact,
  getStorePath,
  listKnowledgeImpacts,
  recordKnowledgeImpact
};
