'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveStoredDelivery,
  parseSupabaseStorageLocation,
  refreshPublicQuotationImages,
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

test('extrae bucket y path de una signedUrl vencida de Supabase', () => {
  const location = parseSupabaseStorageLocation(
    'https://example.supabase.co/storage/v1/object/sign/quotation-assets/ELANVISUAL/quotes/Q-1/rotulo%20principal.webp?token=expired'
  );

  assert.deepEqual(location, {
    bucket: 'quotation-assets',
    path: 'ELANVISUAL/quotes/Q-1/rotulo principal.webp'
  });
});

test('renueva miniaturas de items sin cambiar la estructura pública', async () => {
  const calls = [];
  const storageAdapter = {
    async createDelivery(input) {
      calls.push(input);
      return {
        ...input,
        signedUrl: `https://fresh.example/${encodeURIComponent(input.path)}?token=fresh`,
        expiresIn: input.expiresIn
      };
    }
  };
  const expired = 'https://example.supabase.co/storage/v1/object/sign/quotation-assets/ELANVISUAL/quotes/Q-1/rotulo.webp?token=expired';
  const quotationDocument = {
    schemaVersion: '1.0.0',
    publicDocument: {
      items: [{ id: 'item-1', title: 'Rótulo', imageUrl: expired, images: [expired] }],
      project: { images: [] }
    }
  };

  const refreshed = await refreshPublicQuotationImages({ quotationDocument, storageAdapter });
  const item = refreshed.publicDocument.items[0];

  assert.equal(item.id, 'item-1');
  assert.equal(item.title, 'Rótulo');
  assert.match(item.imageUrl, /token=fresh/);
  assert.match(item.images[0], /token=fresh/);
  assert.notEqual(item.imageUrl, expired);
  assert.deepEqual(calls[0], {
    bucket: 'quotation-assets',
    path: 'ELANVISUAL/quotes/Q-1/rotulo.webp',
    expiresIn: 3600
  });
});

test('deja intactas imágenes externas que no pertenecen a Supabase Storage', async () => {
  const external = 'https://cdn.example.com/product.webp';
  const refreshed = await refreshPublicQuotationImages({
    quotationDocument: {
      publicDocument: {
        items: [{ imageUrl: external, images: [external] }],
        project: { images: [] }
      }
    },
    storageAdapter: {
      async createDelivery() {
        throw new Error('no debe ejecutarse');
      }
    }
  });

  assert.equal(refreshed.publicDocument.items[0].imageUrl, external);
  assert.equal(refreshed.publicDocument.items[0].images[0], external);
});
