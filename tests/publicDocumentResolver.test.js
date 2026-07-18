'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  refreshPublicPdfUrl,
  refreshPublicQuotationImages,
  PUBLIC_IMAGE_SIGN_TTL_SECONDS
} = require('../api/vqsPublicQuotationApi');

const BUCKET = 'official-documents';
const PATH = 'ELANVISUAL/quotations/quote-1/COT-001.pdf';
const FRESH_URL = 'https://signed.example/fresh-document.pdf';
const LEGACY_URL = 'https://legacy.example/quotation.pdf';

function storedQuotation({ delivery = true, legacyUrl = '' } = {}) {
  return {
    id: 'quote-1',
    relations: delivery
      ? { documentDelivery: { bucket: BUCKET, path: PATH } }
      : {},
    ...(legacyUrl ? { pdf_url: legacyUrl } : {})
  };
}

function publicQuotation(pdfUrl = '') {
  return {
    quotationId: 'quote-1',
    quotationNumber: 'COT-001',
    pdfUrl,
    quotation_document: {
      publicDocument: {
        quotationNumber: 'COT-001',
        customer: { name: 'Cliente' },
        items: []
      }
    }
  };
}

function storageAdapter({ signedUrl = FRESH_URL, error = null, calls = [] } = {}) {
  return {
    async uploadObject() { throw new Error('uploadObject no debe ejecutarse'); },
    async objectExists() { throw new Error('objectExists no debe ejecutarse'); },
    async getObjectMetadata() { throw new Error('getObjectMetadata no debe ejecutarse'); },
    async deleteObject() { throw new Error('deleteObject no debe ejecutarse'); },
    async createDelivery(input) {
      calls.push(input);
      if (error) throw error;
      return {
        bucket: input.bucket,
        path: input.path,
        signedUrl,
        expiresIn: input.expiresIn
      };
    }
  };
}

test('metadata valida genera una signedUrl nueva para data.pdfUrl', async () => {
  const calls = [];
  const result = await refreshPublicPdfUrl({
    publicQuotation: publicQuotation(),
    quotation: storedQuotation(),
    storageAdapter: storageAdapter({ calls })
  });

  assert.equal(result.pdfUrl, FRESH_URL);
  assert.deepEqual(calls, [{ bucket: BUCKET, path: PATH, expiresIn: 3600 }]);
});

test('la signedUrl regenerada prevalece sobre una URL historica', async () => {
  const result = await refreshPublicPdfUrl({
    publicQuotation: publicQuotation(LEGACY_URL),
    quotation: storedQuotation({ legacyUrl: LEGACY_URL }),
    storageAdapter: storageAdapter()
  });

  assert.equal(result.pdfUrl, FRESH_URL);
  assert.notEqual(result.pdfUrl, LEGACY_URL);
});

test('cotizacion historica sin metadata conserva pdfUrl y no llama Storage', async () => {
  const calls = [];
  const result = await refreshPublicPdfUrl({
    publicQuotation: publicQuotation(LEGACY_URL),
    quotation: storedQuotation({ delivery: false, legacyUrl: LEGACY_URL }),
    storageAdapter: storageAdapter({ calls })
  });

  assert.equal(result.pdfUrl, LEGACY_URL);
  assert.equal(calls.length, 0);
});

test('sin metadata ni URL historica devuelve pdfUrl vacio y conserva la cotizacion', async () => {
  const calls = [];
  const source = publicQuotation();
  const result = await refreshPublicPdfUrl({
    publicQuotation: source,
    quotation: storedQuotation({ delivery: false }),
    storageAdapter: storageAdapter({ calls })
  });

  assert.equal(result.pdfUrl, '');
  assert.equal(result.quotationNumber, 'COT-001');
  assert.equal(calls.length, 0);
});

test('fallo de firma usa la URL historica sin exponer detalles internos', async () => {
  const error = Object.assign(new Error('service role secret'), {
    code: 'STORAGE_DELIVERY_FAILED',
    token: 'secret-token'
  });
  const result = await refreshPublicPdfUrl({
    publicQuotation: publicQuotation(LEGACY_URL),
    quotation: storedQuotation({ legacyUrl: LEGACY_URL }),
    storageAdapter: storageAdapter({ error })
  });

  assert.equal(result.pdfUrl, LEGACY_URL);
  assert.equal(JSON.stringify(result).includes('service role secret'), false);
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
});

test('fallo de firma sin fallback devuelve pdfUrl vacio sin romper la cotizacion', async () => {
  const error = Object.assign(new Error('internal signing error'), {
    code: 'STORAGE_DELIVERY_FAILED',
    jwt: 'secret-jwt'
  });
  const result = await refreshPublicPdfUrl({
    publicQuotation: publicQuotation(),
    quotation: storedQuotation(),
    storageAdapter: storageAdapter({ error })
  });

  assert.equal(result.pdfUrl, '');
  assert.equal(result.quotationNumber, 'COT-001');
  assert.equal(JSON.stringify(result).includes('internal signing error'), false);
  assert.equal(JSON.stringify(result).includes('secret-jwt'), false);
});

test('la signedUrl no se persiste ni modifica el registro obtenido', async () => {
  const quotation = storedQuotation();
  const beforeQuotation = structuredClone(quotation);
  const response = publicQuotation();
  const beforeResponse = structuredClone(response);
  let updates = 0;
  quotation.updateQuotation = () => { updates += 1; };

  const result = await refreshPublicPdfUrl({
    publicQuotation: response,
    quotation,
    storageAdapter: storageAdapter()
  });

  assert.equal(result.pdfUrl, FRESH_URL);
  assert.equal(updates, 0);
  delete quotation.updateQuotation;
  assert.deepEqual(quotation, beforeQuotation);
  assert.deepEqual(response, beforeResponse);
  assert.equal('signedUrl' in quotation.relations.documentDelivery, false);
});

test('la regeneracion existente de imagenes continua funcionando', async () => {
  const calls = [];
  const expired = 'https://demo.supabase.co/storage/v1/object/sign/quotation-assets/quotes/render.png?token=expired';
  const renewed = 'https://demo.supabase.co/storage/v1/object/sign/quotation-assets/quotes/render.png?token=fresh';
  const quotation = {
    quotation_document: {
      publicDocument: {
        items: [{ title: 'Rotulo', imageUrl: expired }],
        project: { images: [] }
      }
    }
  };
  const storageClient = {
    from(bucket) {
      return {
        async createSignedUrl(path, expiresIn) {
          calls.push({ bucket, path, expiresIn });
          return { data: { signedUrl: renewed }, error: null };
        }
      };
    }
  };

  const result = await refreshPublicQuotationImages(quotation, storageClient);

  assert.deepEqual(calls, [{
    bucket: 'quotation-assets',
    path: 'quotes/render.png',
    expiresIn: PUBLIC_IMAGE_SIGN_TTL_SECONDS
  }]);
  assert.equal(result.quotation_document.publicDocument.items[0].imageUrl, renewed);
  assert.deepEqual(result.quotation_document.publicDocument.items[0].images, [renewed]);
});
