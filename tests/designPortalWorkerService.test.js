'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  processClaimedRequest,
  runDesignPortalWorkerOnce,
  sanitizeNotes
} = require('../services/designPortalWorkerService');

function processedResponse(id) {
  return {
    processed: true,
    provider: 'ELANKAV Design Engine',
    designResult: {
      designId: id,
      status: 'PROCESSED',
      assets: [{ id }]
    }
  };
}

function requestRow(overrides = {}) {
  return {
    id: 'request-1',
    request_code: 'DESIGN-TEST-ABCD',
    external_user_id: '50588888888',
    whatsapp: '50588888888',
    business_name: 'Gimnasio Reyna',
    request_type: 'rotulo',
    installation_environment: 'exterior',
    width_cm: 100,
    height_cm: 80,
    needs_logo_design: true,
    design_notes: 'Logo azul. Precio USD 130.',
    files: [],
    ...overrides
  };
}

test('DESIGN-PIPELINE-02 crea primero logo y después render', async () => {
  const calls = [];
  const uploads = [];
  const adapter = {
    async downloadAsset() { throw new Error('no esperado'); },
    async uploadResult(input) {
      uploads.push(input.kind);
      return { kind: input.kind, bucket: 'bucket', path: `${input.kind}.png` };
    }
  };

  const result = await processClaimedRequest(requestRow(), {
    adapter,
    async processDesign(input) {
      calls.push(input);
      return processedResponse(calls.length === 1 ? 'logo-asset' : 'render-asset');
    },
    async fetchAsset(id) {
      return { buffer: Buffer.from(id), mimeType: 'image/png', fileName: `${id}.png` };
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].projectType, 'LOGO_DESIGN');
  assert.equal(calls[1].projectType, 'COMMERCIAL_SIGN_RENDER');
  assert.equal(calls[1].brandAssets.length, 1);
  assert.deepEqual(uploads, ['generated-logo', 'generated-render']);
  assert.deepEqual(result.resultFiles.map(file => file.kind), [
    'generated-render',
    'generated-logo'
  ]);
  assert.doesNotMatch(calls[0].message, /USD\s*130/);
});

test('DESIGN-PIPELINE-02 completa la fila reclamada', async () => {
  const completed = [];
  const adapter = {
    async getNextPending() { return requestRow({ needs_logo_design: false }); },
    async claimRequest() { return requestRow({ needs_logo_design: false }); },
    async downloadAsset() { throw new Error('no esperado'); },
    async uploadResult(input) {
      return { kind: input.kind, bucket: 'bucket', path: 'render.png' };
    },
    async completeRequest(id, result) { completed.push({ id, result }); },
    async failRequest() { throw new Error('no esperado'); }
  };
  const result = await runDesignPortalWorkerOnce({
    adapter,
    async processDesign() { return processedResponse('render-asset'); },
    async fetchAsset() {
      return { buffer: Buffer.from('png'), mimeType: 'image/png', fileName: 'render.png' };
    }
  });

  assert.equal(result.processed, true);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].result.resultFiles[0].kind, 'generated-render');
  assert.equal(sanitizeNotes('Total $150 y USD 20'), 'Total  y');
});
