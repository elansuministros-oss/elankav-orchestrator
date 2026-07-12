'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  IMPACT_STATUS,
  createKnowledgeImpact,
  getKnowledgeDocument,
  getKnowledgeImpacts,
  listKnowledgeDocuments,
  resolveKnowledgeImpact
} = require('../services/knowledgeService');

function createRepositoryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elankav-kb-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'knowledge', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', '00_MASTER_INDEX.md'), '# Índice\n');
  fs.writeFileSync(path.join(root, 'knowledge', 'README.md'), '# Knowledge\n');
  fs.writeFileSync(path.join(root, 'knowledge', 'nested', '01.md'), '# Uno\n');
  fs.writeFileSync(path.join(root, 'knowledge', 'secret.txt'), 'no permitido');
  return root;
}

test('Knowledge lista únicamente Markdown dentro de raíces oficiales', () => {
  const root = createRepositoryFixture();
  const result = listKnowledgeDocuments(root);

  assert.equal(result.mode, 'read-only');
  assert.deepEqual(result.documents, [
    'docs/00_MASTER_INDEX.md',
    'knowledge/README.md',
    'knowledge/nested/01.md'
  ]);
});

test('Knowledge lee documento oficial con metadatos', () => {
  const root = createRepositoryFixture();
  const result = getKnowledgeDocument('knowledge/README.md', root);

  assert.equal(result.id, 'knowledge/README.md');
  assert.equal(result.root, 'knowledge');
  assert.match(result.content, /Knowledge/);
  assert.ok(result.sizeBytes > 0);
});

test('Knowledge bloquea traversal, rutas externas y archivos no Markdown', () => {
  const root = createRepositoryFixture();

  for (const documentId of [
    '../etc/passwd',
    '/etc/passwd',
    'knowledge/../package.json',
    'knowledge/secret.txt'
  ]) {
    assert.throws(
      () => getKnowledgeDocument(documentId, root),
      error => error.code === 'KNOWLEDGE_DOCUMENT_DENIED'
    );
  }
});

test('Knowledge registra impacto persistente y permite cerrarlo', () => {
  const root = createRepositoryFixture();
  const store = path.join(root, 'state', 'impact.json');

  const created = createKnowledgeImpact({
    movementId: 'KB-001A',
    platform: 'ORCHESTRATOR',
    commit: 'abc123',
    documents: ['knowledge/README.md'],
    status: IMPACT_STATUS.PENDIENTE
  }, store);

  assert.equal(created.status, IMPACT_STATUS.PENDIENTE);
  assert.equal(getKnowledgeImpacts({}, store).length, 1);

  const closed = resolveKnowledgeImpact(
    'KB-001A',
    IMPACT_STATUS.ACTUALIZADO,
    store
  );

  assert.equal(closed.status, IMPACT_STATUS.ACTUALIZADO);
  assert.ok(closed.closedAt);
  assert.equal(
    getKnowledgeImpacts({ status: IMPACT_STATUS.PENDIENTE }, store).length,
    0
  );
});

test('Impacto pendiente requiere documento maestro válido', () => {
  const root = createRepositoryFixture();
  const store = path.join(root, 'impact.json');

  assert.throws(
    () => createKnowledgeImpact({
      movementId: 'JOB-1',
      platform: 'ELANVISUAL',
      documents: [],
      status: IMPACT_STATUS.PENDIENTE
    }, store),
    error => error.code === 'KNOWLEDGE_IMPACT_INVALID'
  );

  assert.throws(
    () => createKnowledgeImpact({
      movementId: 'JOB-2',
      platform: 'ELANVISUAL',
      documents: ['../../otro.md']
    }, store),
    error => error.code === 'KNOWLEDGE_DOCUMENT_DENIED'
  );
});
