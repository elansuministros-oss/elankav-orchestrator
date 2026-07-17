'use strict';

function escapePdfText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/([\\()])/g, '\\$1');
}

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function buildLines(document = {}) {
  const publicDocument = document.publicDocument || document.public_document || document;
  const brand = publicDocument.brandSnapshot || document.brandSnapshot || {};
  const customer = publicDocument.customer || {};
  const items = Array.isArray(publicDocument.items) ? publicDocument.items : [];
  const totals = publicDocument.totals || {};

  const lines = [
    brand.displayName || brand.legalName || 'ELANKAV',
    `Cotizacion ${publicDocument.quotationNumber || document.quotationNumber || ''}`,
    `Cliente: ${customer.name || customer.companyName || ''}`,
    `Fecha: ${String(publicDocument.issuedAt || '').slice(0, 10)}`,
    ''
  ];

  for (const item of items) {
    lines.push(`${item.quantity || 1} x ${item.title || 'Producto'} - USD ${money(item.subtotal)}`);
  }

  lines.push('');
  lines.push(`Subtotal: USD ${money(totals.subtotal)}`);
  lines.push(`IVA: USD ${money(totals.tax)}`);
  lines.push(`Total: USD ${money(totals.total)}`);

  return lines.slice(0, 46);
}

function buildPdfBuffer(lines = []) {
  const content = [
    'BT',
    '/F1 11 Tf',
    '48 790 Td',
    ...lines.flatMap((line, index) => [
      index === 0 ? '' : '0 -16 Td',
      `(${escapePdfText(line)}) Tj`
    ]).filter(Boolean),
    'ET'
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

class QuotationPdfRenderer {
  async render(quotationDocument) {
    if (!quotationDocument || typeof quotationDocument !== 'object') {
      const error = new Error('quotationDocument es obligatorio');
      error.code = 'VQS_PDF_DOCUMENT_REQUIRED';
      throw error;
    }

    return buildPdfBuffer(buildLines(quotationDocument));
  }
}

module.exports = {
  QuotationPdfRenderer,
  buildLines,
  buildPdfBuffer,
  escapePdfText
};
