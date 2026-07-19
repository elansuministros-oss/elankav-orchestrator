const PAYMENT_STATUSES = Object.freeze(['draft', 'confirmed', 'cancelled', 'refunded']);
const PAYMENT_METHODS = Object.freeze(['cash', 'transfer', 'deposit', 'card', 'other']);
const PAYMENT_CURRENCIES = Object.freeze(['USD', 'NIO']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : NaN;
}

function percentage(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 10000) / 10000 : NaN;
}

export function normalizeCustomerPayment(input = {}) {
  return {
    paymentId: text(input.paymentId),
    receiptNumber: text(input.receiptNumber),
    quotationId: text(input.quotationId),
    projectId: text(input.projectId),
    customerId: text(input.customerId),
    executiveId: text(input.executiveId),
    status: text(input.status) || 'confirmed',
    concept: text(input.concept) || 'Anticipo de cotización',
    amount: money(input.amount),
    currency: text(input.currency).toUpperCase() || 'USD',
    paymentMethod: text(input.paymentMethod).toLowerCase(),
    paymentReference: text(input.paymentReference),
    paidAt: text(input.paidAt) || new Date().toISOString(),
    notes: text(input.notes),
    quotationTotal: money(input.quotationTotal),
    requiredDepositPercentage: percentage(input.requiredDepositPercentage),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? { ...input.metadata }
      : {}
  };
}

export function validateCustomerPayment(payment = {}) {
  const errors = [];
  if (!payment.quotationId) errors.push('quotationId es obligatorio');
  if (!payment.projectId) errors.push('projectId es obligatorio');
  if (!payment.customerId) errors.push('customerId es obligatorio');
  if (!payment.executiveId) errors.push('executiveId es obligatorio');
  if (!PAYMENT_STATUSES.includes(payment.status)) errors.push('status no es válido');
  if (!(payment.amount > 0)) errors.push('amount debe ser mayor que cero');
  if (!PAYMENT_CURRENCIES.includes(payment.currency)) errors.push('currency no es válida');
  if (!PAYMENT_METHODS.includes(payment.paymentMethod)) errors.push('paymentMethod no es válido');
  if (!(payment.quotationTotal >= 0)) errors.push('quotationTotal no es válido');
  if (!(payment.requiredDepositPercentage > 0 && payment.requiredDepositPercentage <= 100)) {
    errors.push('requiredDepositPercentage debe estar entre 0 y 100');
  }
  if (Number.isNaN(new Date(payment.paidAt).getTime())) errors.push('paidAt no es válido');
  return { ok: errors.length === 0, errors };
}

export function calculatePaymentBalance({ quotationTotal, previousPaid = 0, currentPayment = 0, requiredDepositPercentage = 60 } = {}) {
  const total = money(quotationTotal);
  const paidBefore = money(previousPaid);
  const payment = money(currentPayment);
  const requiredPercentage = percentage(requiredDepositPercentage);
  if (![total, paidBefore, payment, requiredPercentage].every(Number.isFinite)) {
    const error = new Error('No fue posible calcular el saldo del recibo');
    error.code = 'PAYMENT_BALANCE_INVALID';
    throw error;
  }
  const totalPaid = money(paidBefore + payment);
  const pendingBalance = money(Math.max(total - totalPaid, 0));
  const requiredDepositAmount = money(total * (requiredPercentage / 100));
  return {
    quotationTotal: total,
    previousPaid: paidBefore,
    currentPayment: payment,
    totalPaid,
    pendingBalance,
    requiredDepositPercentage: requiredPercentage,
    requiredDepositAmount,
    depositCompleted: totalPaid >= requiredDepositAmount
  };
}

export const CUSTOMER_PAYMENT_VALUES = Object.freeze({
  statuses: PAYMENT_STATUSES,
  methods: PAYMENT_METHODS,
  currencies: PAYMENT_CURRENCIES
});
