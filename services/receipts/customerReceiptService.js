import {
  calculatePaymentBalance,
  normalizeCustomerPayment,
  validateCustomerPayment
} from '../../modules/receipts/customerPaymentContract.js';

function validationError(errors) {
  const error = new Error(`Pago inválido: ${errors.join('; ')}`);
  error.code = 'CUSTOMER_PAYMENT_VALIDATION_ERROR';
  error.details = errors;
  return error;
}

function quotationTotalUsd(quotation = {}) {
  const values = [
    quotation.total_usd,
    quotation.pricing?.totalUsd,
    quotation.pricing?.total_usd
  ];
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return NaN;
}

function depositPercentage(quotation = {}) {
  const terms = quotation.payment_terms || {};
  const direct = [
    terms.depositPercentage,
    terms.deposit_percentage,
    terms.advance?.percentage,
    terms.anticipo?.percentage
  ];
  for (const value of direct) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0 && number <= 100) return number;
  }

  const installments = Array.isArray(terms.installments) ? terms.installments : [];
  const advance = installments.find((entry) => /anticipo|advance|deposit/i.test(String(entry?.label || entry?.name || '')))
    || installments[0];
  const installmentPercentage = Number(advance?.percentage);
  return Number.isFinite(installmentPercentage) && installmentPercentage > 0 && installmentPercentage <= 100
    ? installmentPercentage
    : 60;
}

export class CustomerReceiptService {
  constructor({ adapter, quoteProjectService } = {}) {
    if (!adapter) throw new Error('CustomerReceiptService requiere adapter');
    this.adapter = adapter;
    this.quoteProjectService = quoteProjectService || null;
  }

  async create(input = {}, actor = {}) {
    const normalized = normalizeCustomerPayment(input);
    const [quotation, project] = await Promise.all([
      this.adapter.getQuotationById(normalized.quotationId),
      this.adapter.getProjectById(normalized.projectId)
    ]);

    if (!quotation) {
      const error = new Error('Cotización no encontrada');
      error.code = 'QUOTATION_NOT_FOUND';
      throw error;
    }
    if (!project || project.quotation_id !== quotation.id) {
      const error = new Error('El proyecto no corresponde a la cotización');
      error.code = 'PAYMENT_PROJECT_LINEAGE_INVALID';
      throw error;
    }

    const payment = {
      ...normalized,
      customerId: String(quotation.customer_id || ''),
      executiveId: String(quotation.executive_id || actor.executiveId || ''),
      quotationTotal: quotationTotalUsd(quotation),
      requiredDepositPercentage: depositPercentage(quotation)
    };

    if (payment.currency !== 'USD') {
      const error = new Error('La API de recibos requiere montos normalizados en USD');
      error.code = 'PAYMENT_CURRENCY_NOT_SUPPORTED';
      error.statusCode = 422;
      throw error;
    }

    const validation = validateCustomerPayment(payment);
    if (!validation.ok) throw validationError(validation.errors);

    const confirmed = await this.adapter.listCustomerPayments({
      quotationId: payment.quotationId,
      statuses: ['confirmed']
    });
    if (confirmed.some((row) => String(row.currency || '').toUpperCase() !== payment.currency)) {
      const error = new Error('Existen pagos históricos sin normalización monetaria compatible');
      error.code = 'PAYMENT_CURRENCY_MIXED';
      error.statusCode = 409;
      throw error;
    }

    const previousPaid = confirmed.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const balance = calculatePaymentBalance({
      quotationTotal: payment.quotationTotal,
      previousPaid,
      currentPayment: payment.amount,
      requiredDepositPercentage: payment.requiredDepositPercentage
    });

    const created = await this.adapter.createCustomerPayment({
      receipt_number: payment.receiptNumber || undefined,
      quotation_id: payment.quotationId,
      project_id: payment.projectId,
      customer_id: payment.customerId,
      executive_id: payment.executiveId,
      status: payment.status,
      concept: payment.concept,
      amount: payment.amount,
      currency: payment.currency,
      payment_method: payment.paymentMethod,
      payment_reference: payment.paymentReference || null,
      paid_at: payment.paidAt,
      notes: payment.notes || null,
      quotation_total: balance.quotationTotal,
      previous_paid: balance.previousPaid,
      total_paid: balance.totalPaid,
      pending_balance: balance.pendingBalance,
      required_deposit_percentage: balance.requiredDepositPercentage,
      required_deposit_amount: balance.requiredDepositAmount,
      deposit_completed: balance.depositCompleted,
      customer_snapshot: quotation.customer_snapshot || {},
      executive_snapshot: quotation.executive_snapshot || {},
      payment_terms_snapshot: quotation.payment_terms || {},
      metadata: payment.metadata,
      confirmed_at: payment.status === 'confirmed' ? new Date().toISOString() : null,
      created_by: actor.userId || null,
      updated_by: actor.userId || null
    });

    if (payment.status === 'confirmed' && balance.depositCompleted && quotation.status !== 'deposit_confirmed') {
      if (!this.quoteProjectService?.confirmDeposit) {
        const error = new Error('No existe servicio autorizado para confirmar el anticipo');
        error.code = 'DEPOSIT_CONFIRMATION_UNAVAILABLE';
        throw error;
      }
      await this.quoteProjectService.confirmDeposit({
        quotationId: payment.quotationId,
        projectId: payment.projectId,
        actor,
        paymentReference: payment.paymentReference || created.receipt_number || created.id
      });
    }

    return { payment: created, balance };
  }
}

export const customerReceiptAuthority = Object.freeze({
  quotationTotalUsd,
  depositPercentage
});