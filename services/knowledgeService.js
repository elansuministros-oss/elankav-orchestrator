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
  return {
    roots: ['docs', 'knowledge'],
    mode: 'read-only',
    count: listOfficialDocuments(repositoryRoot).length,
    documents: listOfficialDocuments(repositoryRoot)
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
