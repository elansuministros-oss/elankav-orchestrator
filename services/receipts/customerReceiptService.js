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

export class CustomerReceiptService {
  constructor({ adapter, quoteProjectService } = {}) {
    if (!adapter) throw new Error('CustomerReceiptService requiere adapter');
    this.adapter = adapter;
    this.quoteProjectService = quoteProjectService || null;
  }

  async create(input = {}, actor = {}) {
    const payment = normalizeCustomerPayment(input);
    const validation = validateCustomerPayment(payment);
    if (!validation.ok) throw validationError(validation.errors);

    const [quotation, project] = await Promise.all([
      this.adapter.getQuotationById(payment.quotationId),
      this.adapter.getProjectById(payment.projectId)
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
    if (String(quotation.customer_id || '') !== payment.customerId) {
      const error = new Error('El cliente no corresponde a la cotización');
      error.code = 'PAYMENT_CUSTOMER_LINEAGE_INVALID';
      throw error;
    }

    const confirmed = await this.adapter.listCustomerPayments({
      quotationId: payment.quotationId,
      statuses: ['confirmed']
    });
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
