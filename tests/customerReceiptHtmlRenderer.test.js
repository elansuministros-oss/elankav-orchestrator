'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  renderCustomerReceiptHtml
} = require('../services/receipts/customerReceiptHtmlRenderer');

function sampleDocument() {
  return {
    schemaVersion: '1.0.0',
    documentType: 'customer_receipt',
    receiptNumber: 'REC-EV-2026-000001',
    issuedAt: '2026-07-19T14:35:00.000Z',
    quotationNumber: 'COT-EV-2026-000145',
    projectNumber: 'PRJ-EV-2026-000087',
    customer: {
      name: 'Cliente de prueba',
      phone: '+505 8888 8888'
    },
    executive: {
      name: 'Erick Cano',
      role: 'Gerente General'
    },
    payment: {
      concept: 'Anticipo correspondiente al 60% de la cotización',
      amount: 1200,
      currency: 'USD',
      method: 'transfer'
    },
    balance: {
      quotationTotal: 2000,
      pendingBalance: 800
    },
    conditions: {
      message: 'Este recibo confirma el pago indicado.'
    },
    metadata: {
      documentVersion: 1
    }
  };
}

test('renderiza número, relaciones, montos y firma digital', () => {
  const html = renderCustomerReceiptHtml(sampleDocument(), {
    company: { name: 'ELANVISUAL' },
    signature: { name: 'Erick Cano', role: 'Gerente General' }
  });

  assert.match(html, /REC-EV-2026-000001/);
  assert.match(html, /COT-EV-2026-000145/);
  assert.match(html, /PRJ-EV-2026-000087/);
  assert.match(html, /USD 1,200\.00/);
  assert.match(html, /USD 800\.00/);
  assert.match(html, /DOCUMENTO FIRMADO DIGITALMENTE/);
  assert.match(html, /La descarga del PDF se registrará/);
  assert.match(html, /@media\(max-width:700px\)/);
});

test('escapa contenido dinámico para evitar inyección HTML', () => {
  const document = sampleDocument();
  document.customer.name = '<script>alert(1)</script>';

  const html = renderCustomerReceiptHtml(document);

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('rechaza documentos que no sean recibos de cliente', () => {
  assert.throws(
    () => renderCustomerReceiptHtml({ documentType: 'quotation' }),
    (error) => error.code === 'RECEIPT_HTML_DOCUMENT_INVALID'
  );
});
