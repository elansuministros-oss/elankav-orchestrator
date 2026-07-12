'use strict';

const {
  listOfficialDocuments,
  readOfficialDocument
} = require('../adapters/knowledgeAdapter');
const {
  IMPACT_STATUS,
  closeKnowledgeImpact,
  listKnowledgeImpacts,
  recordKnowledgeImpact
} = require('./knowledgeImpactService');

function listKnowledgeDocuments(repositoryRoot = process.cwd()) {
  const documents = listOfficialDocuments(repositoryRoot);

  return {
    roots: ['docs', 'knowledge'],
    mode: 'read-only',
    count: documents.length,
    documents
  };
}

function getKnowledgeDocument(documentId, repositoryRoot = process.cwd()) {
  return readOfficialDocument(documentId, repositoryRoot);
}

function createKnowledgeImpact(payload, storePath) {
  return recordKnowledgeImpact(payload, storePath);
}

function getKnowledgeImpacts(filters, storePath) {
  return listKnowledgeImpacts(filters, storePath);
}

function resolveKnowledgeImpact(movementId, status, storePath) {
  return closeKnowledgeImpact(movementId, status, storePath);
}

module.exports = {
  IMPACT_STATUS,
  createKnowledgeImpact,
  getKnowledgeDocument,
  getKnowledgeImpacts,
  listKnowledgeDocuments,
  resolveKnowledgeImpact
};
