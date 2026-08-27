const test = require('node:test');
const assert = require('node:assert/strict');

const {
  handleVqsPublicQuotationApi,
  resolveStorageObjectReference,
  PUBLIC_IMAGE_SIGN_TTL_SECONDS
} = require('../api/vqsPublicQuotationApi');

function makeReq({ url = '/api/vqs/public/quotations/22222222-2222-4222-8222-222222222222', method = 'GET' } = {}) {
  return { url, method, headers: { host: 'localhost' } };
}

function makeResponse() {
  const state = { statusCode: null, payload: null, headers: {} };
  return {
    state,
    res: { setHeader(name, value) { state.headers[name] = value; } },
    sendJson(_res, statusCode, payload) { state.statusCode = statusCode; state.payload = payload; }
  };
}

function buildAdapter({ imageUrl = '', images = [] } = {}) {
  const quotation = {
    id: '11111111-1111-4111-8111-111111111111',
    quotation_number: 'COT-20260717-00005',
    platform_id: 'ELANVISUAL',
    source_type: 'manual',
    source_id: 'manual-1',
    design_mode: 'optional',
    customer_id: 'customer-1',
    executive_id: 'EXEC-ERICK-CANO-001',
    status: 'draft',
    issued_at: '2026-07-17T10:00:00.000Z',
    valid_until: '2099-08-01T10:00:00.000Z',
    customer_snapshot: { name: 'Karen Vega', companyName: 'VICKAND Coffee', phone: '+505 7882 8089' },
    executive_snapshot: { executiveId: 'EXEC-ERICK-CANO-001', name: 'Erick Cano' },
    items: [{
      title: 'Rotulo comercial',
      quantity: 1,
      unit: 'unidad',
      unitPriceUsd: 290,
      subtotalUsd: 290,
      ...(imageUrl ? { imageUrl } : {}),
      ...(images.length ? { images } : {})
    }],
    pricing: {
      subtotalUsd: 290,
      discountUsd: 0,
      taxRate: 0,
      taxUsd: 0,
      totalUsd: 290,
      exchangeRate: 36.6243,
      payableTotalNio: 10621.05
    },
    payment_terms: { type: '60_40', installments: [] },
    relations: { customerId: 'customer-1', executiveId: 'EXEC-ERICK-CANO-001' },
    total_usd: 290,
    payable_total_nio: 10621.05
  };
  const project = {
    id: '22222222-2222-4222-8222-222222222222',
    project_number: 'PRJ-20260717-00005',
    quotation_id: quotation.id,
    platform_id: 'ELANVISUAL',
    customer_id: 'customer-1',
    executive_id: 'EXEC-ERICK-CANO-001',
    title: 'Rotulo comercial',
    status: 'pending_activation',
    current_stage: 'quotation',
    priority: 'normal'
  };

  return {
    async getProjectById(projectId) {
      return projectId === project.id ? project : null;
    },
    async getQuotationById(quotationId) {
      return quotationId === quotation.id ? quotation : null;
    },
    async getQuotationByNumber(quotationNumber) {
      return quotationNumber === quotation.quotation_number ? quotation : null;
    },
    async getProjectByQuotationId(quotationId) {
      return quotationId === quotation.id ? project : null;
    }
  };
}

test('VQS publica cotizacion reconstruida desde projectId', async () => {
  const response = makeResponse();

  await handleVqsPublicQuotationApi({
    req: makeReq(),
    res: response.res,
    sendJson: response.sendJson,
    adapter: buildAdapter(),
    storageClient: { from() { throw new Error('storage no debe usarse sin imagenes'); } }
  });

  assert.equal(response.state.statusCode, 200);
  assert.equal(response.state.payload.data.projectId, '22222222-2222-4222-8222-222222222222');
  assert.equal(response.state.payload.data.quotationNumber, 'COT-20260717-00005');
  assert.equal(response.state.payload.data.quotation_document.publicDocument.customer.name, 'Karen Vega');
  assert.equal(response.state.payload.data.quotation_document.publicDocument.totals.total, 290);
});

test('extrae bucket y object path desde signedUrl vencida de Supabase', () => {
  const reference = resolveStorageObjectReference(
    'https://demo.supabase.co/storage/v1/object/sign/quotation-assets/quotes%2F2026/render%20final.png?token=expired'
  );

  assert.deepEqual(reference, {
    bucket: 'quotation-assets',
    path: 'quotes/2026/render final.png'
  });
});

test('renueva la signedUrl al construir la respuesta publica', async () => {
  const response = makeResponse();
  const calls = [];
  const expiredUrl = 'https://demo.supabase.co/storage/v1/object/sign/quotation-assets/quotes/render.png?token=expired';
  const renewedUrl = 'https://demo.supabase.co/storage/v1/object/sign/quotation-assets/quotes/render.png?token=fresh';

  const storageClient = {
    from(bucket) {
      return {
        async createSignedUrl(path, expiresIn) {
          calls.push({ bucket, path, expiresIn });
          return { data: { signedUrl: renewedUrl }, error: null };
        }
      };
    }
  };

  await handleVqsPublicQuotationApi({
    req: makeReq(),
    res: response.res,
    sendJson: response.sendJson,
    adapter: buildAdapter({ imageUrl: expiredUrl }),
    storageClient
  });

  assert.equal(response.state.statusCode, 200);
  assert.deepEqual(calls, [{
    bucket: 'quotation-assets',
    path: 'quotes/render.png',
    expiresIn: PUBLIC_IMAGE_SIGN_TTL_SECONDS
  }]);
  assert.equal(response.state.payload.data.quotation_document.publicDocument.items[0].imageUrl, renewedUrl);
  assert.deepEqual(response.state.payload.data.quotation_document.publicDocument.items[0].images, [renewedUrl]);
});
test('renueva imagen publica desde bucket y objectPath estable', async () => {
  const response = makeResponse();
  const calls = [];
  const asset = {
    kind: 'quotation-image',
    itemId: 'item-1',
    bucket: 'elanvisual',
    objectPath: 'ELANVISUAL/quotation-assets/2026/07/item-1/asset-1.webp',
    mimeType: 'image/webp',
    sizeBytes: 456
  };
  const renewedUrl = 'https://demo.supabase.co/storage/v1/object/sign/elanvisual/ELANVISUAL/quotation-assets/2026/07/item-1/asset-1.webp?token=fresh';

  const storageClient = {
    from(bucket) {
      return {
        async createSignedUrl(path, expiresIn) {
          calls.push({ bucket, path, expiresIn });
          return { data: { signedUrl: renewedUrl }, error: null };
        }
      };
    }
  };

  await handleVqsPublicQuotationApi({
    req: makeReq(),
    res: response.res,
    sendJson: response.sendJson,
    adapter: buildAdapter({ images: [asset] }),
    storageClient
  });

  assert.equal(response.state.statusCode, 200);
  assert.deepEqual(calls, [{
    bucket: 'elanvisual',
    path: 'ELANVISUAL/quotation-assets/2026/07/item-1/asset-1.webp',
    expiresIn: PUBLIC_IMAGE_SIGN_TTL_SECONDS
  }]);
  assert.equal(response.state.payload.data.quotation_document.publicDocument.items[0].imageUrl, renewedUrl);
  assert.deepEqual(response.state.payload.data.quotation_document.publicDocument.items[0].images, [renewedUrl]);
});
