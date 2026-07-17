'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveStoredDelivery,
  refreshPublicQuotationDelivery
} = require('../services/vqs/publicQuotationDeliveryService');

test('resuelve bucket y objectPath de cotizaciones antiguas', () => {
  const delivery = resolveStoredDelivery({
    relations: {
      document_delivery: {
        bucket: 'official-documents',
        objectPath: 'ELANVISUAL/quotations/q-old/COT-OLD.pdf',
        signedUrl: 'https://expired.example/old'
      }
    }
  });

  assert.equal(delivery.bucket, 'official-documents');
  assert.equal(delivery.path, 'ELANVISUAL/quotations/q-old/COT-OLD.pdf');
});

test('renueva la signedUrl en cada consulta pública sin reutilizar la almacenada', async () => {
  const calls = [];
  let sequence = 0;
  const storageAdapter = {
    async createDelivery(input) {
      calls.push(input);
      sequence += 1;
      return {
        ...input,
        signedUrl: `https://signed.example/document.pdf?token=${sequence}`,
        expiresIn: input.expiresIn
      };
    }
  };
  const quotation = {
    relations: {
      documentDelivery: {
        bucket: 'official-documents',
        path: 'ELANVISUAL/quotations/q-1/COT-1.pdf',
        signedUrl: 'https://expired.example/document.pdf'
      }
    }
  };

  const first = await refreshPublicQuotationDelivery({ quotation, storageAdapter, expiresIn: 3600 });
  const second = await refreshPublicQuotationDelivery({ quotation, storageAdapter, expiresIn: 3600 });

  assert.equal(first.signedUrl, 'https://signed.example/document.pdf?token=1');
  assert.equal(second.signedUrl, 'https://signed.example/document.pdf?token=2');
  assert.notEqual(first.signedUrl, quotation.relations.documentDelivery.signedUrl);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    bucket: 'official-documents',
    path: 'ELANVISUAL/quotations/q-1/COT-1.pdf',
    expiresIn: 3600
  });
});

test('mantiene compatibilidad cuando no existe metadata de Storage', async () => {
  const result = await refreshPublicQuotationDelivery({
    quotation: { public_url: 'https://legacy.example/quotation' },
    storageAdapter: {
      async createDelivery() {
        throw new Error('no debe ejecutarse');
      }
    }
  });

  assert.equal(result, null);
});
