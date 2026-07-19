'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value, currency = 'USD') {
  const amount = Number(value || 0);
  return `${escapeHtml(currency)} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function labelPaymentMethod(method) {
  const labels = {
    cash: 'Efectivo',
    transfer: 'Transferencia bancaria',
    deposit: 'Depósito bancario',
    card: 'Tarjeta',
    other: 'Otro'
  };
  return labels[method] || method || 'No especificado';
}

function renderCustomerReceiptHtml(document, options = {}) {
  if (!document || document.documentType !== 'customer_receipt') {
    const error = new Error('Se requiere un documento customer_receipt válido');
    error.code = 'RECEIPT_HTML_DOCUMENT_INVALID';
    throw error;
  }

  const company = options.company || {};
  const signature = options.signature || {};
  const customer = document.customer || {};
  const executive = document.executive || {};
  const currency = document.payment?.currency || 'USD';
  const issuedAt = document.issuedAt ? new Date(document.issuedAt) : null;
  const issuedLabel = issuedAt && !Number.isNaN(issuedAt.getTime())
    ? issuedAt.toLocaleString('es-NI', { timeZone: 'America/Managua' })
    : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.receiptNumber || 'Recibo oficial')}</title>
<style>
:root{--ink:#172033;--muted:#687386;--line:#e4e8ef;--soft:#f5f7fa;--brand:#113b67;--accent:#14865f;--warn:#b76e18}
*{box-sizing:border-box}body{margin:0;background:#eef1f5;color:var(--ink);font-family:Arial,Helvetica,sans-serif}.page{width:min(900px,calc(100% - 24px));margin:20px auto 40px;background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(28,39,55,.12);overflow:hidden}.header{padding:28px 30px 22px;background:linear-gradient(135deg,#0e3157,#174f83);color:#fff}.brand{display:flex;align-items:center;justify-content:space-between;gap:20px}.logo{font-weight:900;letter-spacing:.07em;font-size:22px}.doc-title{text-align:right}.doc-title h1{margin:0;font-size:24px;letter-spacing:.04em}.doc-title p{margin:6px 0 0;opacity:.84;font-size:13px}.content{padding:28px 30px 34px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:24px}.card{border:1px solid var(--line);border-radius:14px;padding:18px}.card h2{margin:0 0 14px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.row{display:flex;justify-content:space-between;gap:20px;padding:7px 0;border-bottom:1px dashed #e6e9ee;font-size:14px}.row:last-child{border-bottom:0}.row span:first-child{color:var(--muted)}.row strong{text-align:right}.financial{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}.metric{border-radius:14px;padding:18px;border:1px solid var(--line);background:#fbfcfd}.metric span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px}.metric strong{font-size:24px}.metric.paid{border-color:#bde5d4;background:#f0fbf6}.metric.paid strong{color:var(--accent)}.metric.balance{border-color:#eed6b9;background:#fff9f1}.metric.balance strong{color:var(--warn)}.concept{margin:22px 0;padding:18px;border-left:4px solid var(--brand);background:var(--soft);border-radius:0 12px 12px 0}.concept h3{margin:0 0 8px;font-size:14px}.concept p{margin:0;color:#414b5d;line-height:1.55}.signature{display:grid;grid-template-columns:1.3fr .7fr;gap:20px;margin-top:24px;padding-top:22px;border-top:1px solid var(--line)}.signature-box,.delivery{border:1px solid var(--line);border-radius:14px;padding:18px}.signature-box{min-height:160px}.sign{font-family:"Segoe Script","Brush Script MT",cursive;font-size:31px;color:#183c67;margin:15px 0 2px;transform:rotate(-4deg)}.verified{display:inline-block;margin-top:12px;padding:7px 10px;border-radius:999px;background:#edf8f3;color:#08704c;font-size:11px;font-weight:800;letter-spacing:.05em}.delivery{background:#fafbfc}.delivery h3{margin:0 0 10px;font-size:14px}.status{display:flex;align-items:center;gap:8px;font-weight:800;color:var(--accent)}.dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}.small{color:var(--muted);font-size:12px;line-height:1.5}.footer{display:flex;justify-content:space-between;gap:20px;padding:18px 30px;background:#f5f7fa;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:700px){.page{width:100%;margin:0;border-radius:0}.header,.content{padding-left:18px;padding-right:18px}.brand{align-items:flex-start}.doc-title h1{font-size:19px}.meta,.financial,.signature{grid-template-columns:1fr}.financial{gap:10px}.metric strong{font-size:22px}.footer{padding:16px 18px;flex-direction:column}}@media print{body{background:#fff}.page{width:100%;margin:0;box-shadow:none;border-radius:0}}
</style>
</head>
<body>
<main class="page">
<header class="header"><div class="brand"><div><div class="logo">${escapeHtml(company.name || 'ELANVISUAL')}</div><div style="opacity:.8;font-size:12px;margin-top:5px">Documento oficial de pago</div></div><div class="doc-title"><h1>RECIBO OFICIAL</h1><p>${escapeHtml(document.receiptNumber)}</p></div></div></header>
<section class="content">
<div class="meta">
<article class="card"><h2>Cliente</h2><div class="row"><span>Nombre</span><strong>${escapeHtml(customer.name || customer.fullName || '')}</strong></div><div class="row"><span>Teléfono</span><strong>${escapeHtml(customer.phone || '')}</strong></div><div class="row"><span>Ejecutivo</span><strong>${escapeHtml(executive.name || signature.name || '')}</strong></div></article>
<article class="card"><h2>Documento relacionado</h2><div class="row"><span>Cotización</span><strong>${escapeHtml(document.quotationNumber || '')}</strong></div><div class="row"><span>Proyecto</span><strong>${escapeHtml(document.projectNumber || '')}</strong></div><div class="row"><span>Fecha</span><strong>${escapeHtml(issuedLabel)}</strong></div><div class="row"><span>Método</span><strong>${escapeHtml(labelPaymentMethod(document.payment?.method))}</strong></div></article>
</div>
<section class="financial"><div class="metric"><span>Total cotización</span><strong>${money(document.balance?.quotationTotal,currency)}</strong></div><div class="metric paid"><span>Pago recibido</span><strong>${money(document.payment?.amount,currency)}</strong></div><div class="metric balance"><span>Saldo pendiente</span><strong>${money(document.balance?.pendingBalance,currency)}</strong></div></section>
<section class="concept"><h3>Concepto del pago</h3><p>${escapeHtml(document.payment?.concept || 'Pago de cotización')}. ${escapeHtml(document.conditions?.message || '')}</p></section>
<section class="signature"><div class="signature-box"><div class="small">Firmado digitalmente por</div><div class="sign">${escapeHtml(signature.displayName || signature.name || executive.name || '')}</div><strong>${escapeHtml(signature.name || executive.name || '')}</strong><br><span class="small">${escapeHtml(signature.role || executive.role || 'Ejecutivo')} · ${escapeHtml(company.name || 'ELANVISUAL')}</span><br><span class="verified">✓ DOCUMENTO FIRMADO DIGITALMENTE</span></div><div class="delivery"><h3>Entrega digital</h3><div class="status"><span class="dot"></span> Generado</div><p class="small">La descarga del PDF se registrará como evidencia técnica de entrega al dispositivo.</p><div class="row"><span>Canal</span><strong>WhatsApp</strong></div><div class="row"><span>Versión</span><strong>${escapeHtml(document.metadata?.documentVersion || '1')}</strong></div></div></section>
</section>
<footer class="footer"><div>${escapeHtml(company.taxId || 'RUC 4012805831001E')} · ${escapeHtml(company.website || 'visual.elankav.com')}</div><div>${escapeHtml(company.whatsapp || 'WhatsApp +505 7882 8089')}</div></footer>
</main>
</body>
</html>`;
}

class CustomerReceiptHtmlRenderer {
  render(document, options) {
    return renderCustomerReceiptHtml(document, options);
  }
}

module.exports = { CustomerReceiptHtmlRenderer, renderCustomerReceiptHtml };
