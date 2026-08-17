'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  renderCustomerReceiptHtml
} = require('../services/receipts/customerReceiptHtmlRenderer');

function sampleDocument() {
  return {
    schemaVersion: '1.1.0',
    documentType: 'customer_receipt',
    receiptNumber: 'REC-EV-2026-000001',
    issuedAt: '2026-07-19T14:35:00.000Z',
    quotationNumber: 'COT-EV-2026-000145',
    projectNumber: 'PRJ-EV-2026-000087',
    brandSnapshot: {
      displayName: 'ELANVISUAL',
      taxId: '4012805831001E',
      website: 'https://visual.elankav.com',
      whatsapp: '+505 7882 8089',
      colors: { primary: '#111827', secondary: '#C9A227' }
    },
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

test('renderiza número, relaciones, montos, firma y branding del snapshot', () => {
  const html = renderCustomerReceiptHtml(sampleDocument(), {
    signature: { name: 'Erick Cano', role: 'Gerente General' }
  });

  assert.match(html, /REC-EV-2026-000001/);
  assert.match(html, /COT-EV-2026-000145/);
  assert.match(html, /PRJ-EV-2026-000087/);
  assert.match(html, /USD 1,200\.00/);
  assert.match(html, /USD 800\.00/);
  assert.match(html, /ELANVISUAL/);
  assert.match(html, /RUC 4012805831001E/);
  assert.match(html, /https:\/\/visual\.elankav\.com/);
  assert.match(html, /WhatsApp \+505 7882 8089/);
  assert.match(html, /--brand:#111827/);
  assert.match(html, /DOCUMENTO FIRMADO DIGITALMENTE/);
  assert.match(html, /La descarga del PDF se registrará/);
  assert.match(html, /@media\(max-width:700px\)/);
});

test('permite override explícito sin perder el snapshot como fuente base', () => {
  const html = renderCustomerReceiptHtml(sampleDocument(), {
    company: { displayName: 'MARCA DE PRUEBA' }
  });
  assert.match(html, /MARCA DE PRUEBA/);
  assert.match(html, /RUC 4012805831001E/);
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
