'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCustomerReceiptDocument } = require('../services/receipts/customerReceiptDocumentBuilder');

function fixture() {
  const quotation = {
    id: 'quotation-1',
    quotation_number: 'COT-20260718-00013',
    platform_id: 'ELANVISUAL',
    customer_snapshot: { name: 'Repuesto y accesorios El león de Judá', phone: '+50584669559' },
    executive_snapshot: { name: 'Erick Cano', role: 'Director Comercial' },
    payment_terms: { depositPercentage: 60, balance: '40% contra entrega' }
  };
  const project = { id: 'project-1', project_number: 'PRY-2026-000013' };
  const payment = {
    id: 'payment-1',
    receipt_number: 'REC-2026-000001',
    quotation_id: quotation.id,
    project_id: project.id,
    status: 'confirmed',
    concept: 'Anticipo del 60%',
    amount: 1200.02,
    currency: 'USD',
    payment_method: 'transfer',
    payment_reference: 'TX-001',
    paid_at: '2026-07-19T21:00:00.000Z',
    quotation_total: 2000.04,
    previous_paid: 0,
    total_paid: 1200.02,
    pending_balance: 800.02,
    required_deposit_percentage: 60,
    required_deposit_amount: 1200.02,
    deposit_completed: true,
    customer_snapshot: quotation.customer_snapshot,
    executive_snapshot: quotation.executive_snapshot,
    payment_terms_snapshot: quotation.payment_terms
  };
  return { payment, quotation, project };
}

test('construye recibo oficial vinculado a cotización, proyecto y marca', () => {
  const document = buildCustomerReceiptDocument(fixture());
  assert.equal(document.documentType, 'customer_receipt');
  assert.equal(document.receiptNumber, 'REC-2026-000001');
  assert.equal(document.quotationNumber, 'COT-20260718-00013');
  assert.equal(document.projectNumber, 'PRY-2026-000013');
  assert.equal(document.platformId, 'ELANVISUAL');
  assert.equal(document.canonicalPlatformId, 'elanvisual');
  assert.equal(document.platformCode, 'ELANVISUAL');
  assert.equal(document.brandSnapshot.displayName, 'ELANVISUAL');
  assert.equal(document.brandSnapshot.registryVersion, '1.1.0');
  assert.equal(document.customer.name, 'Repuesto y accesorios El león de Judá');
  assert.equal(document.executive.name, 'Erick Cano');
  assert.equal(document.payment.amount, 1200.02);
  assert.equal(document.balance.pendingBalance, 800.02);
  assert.equal(document.balance.depositCompleted, true);
  assert.equal(document.conditions.quotationRemainsAuthoritative, true);
});

test('acepta el identificador canónico en minúsculas', () => {
  const input = fixture();
  input.quotation.platform_id = 'elanvisual';
  const document = buildCustomerReceiptDocument(input);
  assert.equal(document.brandSnapshot.platformCode, 'ELANVISUAL');
  assert.equal(document.canonicalPlatformId, 'elanvisual');
});

test('rechaza plataformas sin registro de marca', () => {
  const input = fixture();
  input.quotation.platform_id = 'plataforma-inexistente';
  assert.throws(
    () => buildCustomerReceiptDocument(input),
    (error) => error.code === 'RECEIPT_PLATFORM_NOT_FOUND'
  );
});

test('rechaza un pago vinculado a otro proyecto', () => {
  const input = fixture();
  input.payment.project_id = 'project-otro';
  assert.throws(
    () => buildCustomerReceiptDocument(input),
    (error) => error.code === 'RECEIPT_DOCUMENT_LINEAGE_INVALID'
  );
});
