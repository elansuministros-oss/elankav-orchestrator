'use strict';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function buildCustomerReceiptDocument({ payment, quotation, project } = {}) {
  if (!payment || !quotation || !project) {
    const error = new Error('payment, quotation y project son obligatorios');
    error.code = 'RECEIPT_DOCUMENT_BUILD_INPUT_INVALID';
    throw error;
  }
  if (payment.quotation_id !== quotation.id || payment.project_id !== project.id) {
    const error = new Error('El pago no corresponde a la cotización y proyecto indicados');
    error.code = 'RECEIPT_DOCUMENT_LINEAGE_INVALID';
    throw error;
  }

  return {
    schemaVersion: '1.0.0',
    documentType: 'customer_receipt',
    receiptId: payment.id,
    receiptNumber: payment.receipt_number,
    status: payment.status,
    issuedAt: payment.paid_at || payment.created_at,
    platformId: quotation.platform_id,
    quotationId: quotation.id,
    quotationNumber: quotation.quotation_number,
    projectId: project.id,
    projectNumber: project.project_number,
    customer: object(payment.customer_snapshot || quotation.customer_snapshot),
    executive: object(payment.executive_snapshot || quotation.executive_snapshot),
    payment: {
      concept: payment.concept,
      amount: number(payment.amount),
      currency: payment.currency,
      method: payment.payment_method,
      reference: payment.payment_reference || '',
      notes: payment.notes || ''
    },
    balance: {
      quotationTotal: number(payment.quotation_total),
      previousPaid: number(payment.previous_paid),
      currentPayment: number(payment.amount),
      totalPaid: number(payment.total_paid),
      pendingBalance: number(payment.pending_balance),
      requiredDepositPercentage: number(payment.required_deposit_percentage),
      requiredDepositAmount: number(payment.required_deposit_amount),
      depositCompleted: Boolean(payment.deposit_completed)
    },
    paymentTerms: object(payment.payment_terms_snapshot || quotation.payment_terms),
    conditions: {
      quotationRemainsAuthoritative: true,
      message: 'Este recibo confirma el pago indicado y no sustituye ni modifica las condiciones de la cotización vinculada.'
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      source: 'ELANKAV ERP'
    }
  };
}

class CustomerReceiptDocumentBuilder {
  build(input) {
    return buildCustomerReceiptDocument(input);
  }
}

module.exports = {
  CustomerReceiptDocumentBuilder,
  buildCustomerReceiptDocument
};
