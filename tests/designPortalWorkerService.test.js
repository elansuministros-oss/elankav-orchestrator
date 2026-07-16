'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deliverCompletedRequest,
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
    customer_name: 'Cliente Prueba',
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

test('DESIGN-PIPELINE-02 completa la fila reclamada y entrega el código por WhatsApp', async () => {
  const completed = [];
  const deliveries = [];
  const deliveryUpdates = [];
  const claimedRow = requestRow({ needs_logo_design: false });
  const adapter = {
    async getNextPending() { return claimedRow; },
    async claimRequest() { return claimedRow; },
    async downloadAsset() { throw new Error('no esperado'); },
    async uploadResult(input) {
      return {
        kind: input.kind,
        bucket: 'bucket',
        path: 'render.png',
        mimeType: 'image/png',
        sizeBytes: 3
      };
    },
    async resolveDesignAsset(input) {
      return { ...input, signedUrl: 'https://storage.test/render.png' };
    },
    async completeRequest(id, result) {
      completed.push({ id, result });
      return {
        ...claimedRow,
        status: 'review',
        result_files: result.resultFiles,
        design_result: result.designResult
      };
    },
    async markDeliverySuccess(id, delivery) {
      deliveryUpdates.push({ id, status: 'delivered', delivery });
    },
    async markDeliveryFailure() { throw new Error('no esperado'); },
    async failRequest() { throw new Error('no esperado'); }
  };
  const result = await runDesignPortalWorkerOnce({
    adapter,
    delivery: {
      async sendImage(input) {
        deliveries.push({ type: 'image', ...input });
        return { chatId: '50588888888@c.us', messageId: 'image-1' };
      },
      async sendText(input) {
        deliveries.push({ type: 'text', ...input });
        return { chatId: '50588888888@c.us', messageId: 'text-1' };
      }
    },
    async processDesign() { return processedResponse('render-asset'); },
    async fetchAsset() {
      return { buffer: Buffer.from('png'), mimeType: 'image/png', fileName: 'render.png' };
    }
  });

  assert.equal(result.processed, true);
  assert.equal(result.delivery.delivered, true);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].result.resultFiles[0].kind, 'generated-render');
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0].type, 'image');
  assert.equal(deliveries[0].phone, '50588888888');
  assert.equal(deliveries[0].imageUrl, 'https://storage.test/render.png');
  assert.match(deliveries[0].caption, /Tu propuesta de diseño está lista/);
  assert.match(deliveries[0].caption, /Código de seguimiento: DESIGN-TEST-ABCD/);
  assert.equal(deliveries[1].type, 'text');
  assert.equal(deliveries[1].chatId, '50588888888@c.us');
  assert.match(deliveries[1].text, /CAMBIOS DESIGN-TEST-ABCD/);
  assert.equal(deliveryUpdates[0].id, 'request-1');
  assert.equal(deliveryUpdates[0].delivery.imageMessageId, 'image-1');
  assert.equal(deliveryUpdates[0].delivery.textMessageId, 'text-1');
  assert.equal(deliveryUpdates[0].delivery.assetPath, 'render.png');
  assert.equal(sanitizeNotes('Total $150 y USD 20'), 'Total  y');
});

test('DESIGN-DELIVERY-CLOSE-01 no marca entrega si falla el envío de imagen', async () => {
  const failures = [];
  const texts = [];
  const row = requestRow({
    status: 'review',
    delivery_attempts: 0,
    result_files: [{
      kind: 'generated-render',
      bucket: 'bucket',
      path: 'render.png',
      mimeType: 'image/png',
      sizeBytes: 3
    }],
    design_result: { processed: true }
  });

  const result = await deliverCompletedRequest(row, {
    adapter: {
      async resolveDesignAsset(input) {
        return { ...input, signedUrl: 'https://storage.test/render.png' };
      },
      async markDeliverySuccess() { throw new Error('no esperado'); },
      async markDeliveryFailure(id, errorCode, attempts, delivery) {
        failures.push({ id, errorCode, attempts, delivery });
      }
    },
    delivery: {
      async sendImage() {
        const error = new Error('WAHA HTTP 500');
        error.code = 'WAHA_HTTP_500';
        throw error;
      },
      async sendText(input) {
        texts.push(input);
      }
    }
  });

  assert.deepEqual(result, { delivered: false, errorCode: 'WAHA_HTTP_500' });
  assert.equal(texts.length, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, 'request-1');
  assert.equal(failures[0].attempts, 1);
  assert.equal(failures[0].delivery.imageMessageId, '');
});
