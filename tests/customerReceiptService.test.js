'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

async function modules() {
  const contract = await import('../modules/receipts/customerPaymentContract.js');
  const service = await import('../services/receipts/customerReceiptService.js');
  return { ...contract, ...service };
}

function fixture() {
  const payments = [];
  const confirmedDeposits = [];
  const quotation = {
    id: 'quotation-1',
    status: 'awaiting_deposit',
    customer_id: 'customer-1',
    executive_id: 'executive-1',
    customer_snapshot: { name: 'Cliente Prueba' },
    executive_snapshot: { name: 'Ejecutivo Prueba' },
    payment_terms: { depositPercentage: 60 }
  };
  const project = { id: 'project-1', quotation_id: quotation.id };
  const adapter = {
    async getQuotationById(id) { return id === quotation.id ? quotation : null; },
    async getProjectById(id) { return id === project.id ? project : null; },
    async listCustomerPayments() { return payments.filter((row) => row.status === 'confirmed'); },
    async createCustomerPayment(row) {
      const created = { id: `payment-${payments.length + 1}`, receipt_number: `REC-2026-${String(payments.length + 1).padStart(6, '0')}`, ...row };
      payments.push(created);
      return created;
    }
  };
  const quoteProjectService = {
    async confirmDeposit(input) { confirmedDeposits.push(input); quotation.status = 'deposit_confirmed'; }
  };
  return { adapter, quoteProjectService, payments, confirmedDeposits };
}

function paymentInput(overrides = {}) {
  return {
    quotationId: 'quotation-1',
    projectId: 'project-1',
    customerId: 'customer-1',
    executiveId: 'executive-1',
    amount: 600,
    currency: 'USD',
    paymentMethod: 'transfer',
    paymentReference: 'TX-001',
    quotationTotal: 1000,
    requiredDepositPercentage: 60,
    ...overrides
  };
}

test('calcula saldo del anticipo sin permitir valores manuales derivados', async () => {
  const { calculatePaymentBalance } = await modules();
  assert.deepEqual(calculatePaymentBalance({
    quotationTotal: 2000.04,
    previousPaid: 0,
    currentPayment: 1200.02,
    requiredDepositPercentage: 60
  }), {
    quotationTotal: 2000.04,
    previousPaid: 0,
    currentPayment: 1200.02,
    totalPaid: 1200.02,
    pendingBalance: 800.02,
    requiredDepositPercentage: 60,
    requiredDepositAmount: 1200.02,
    depositCompleted: true
  });
});

test('crea recibo vinculado y activa proyecto al cubrir el anticipo', async () => {
  const { CustomerReceiptService } = await modules();
  const state = fixture();
  const service = new CustomerReceiptService(state);
  const result = await service.create(paymentInput(), { userId: 'owner-1', role: 'owner' });

  assert.equal(result.payment.quotation_id, 'quotation-1');
  assert.equal(result.payment.project_id, 'project-1');
  assert.equal(result.payment.pending_balance, 400);
  assert.equal(result.balance.depositCompleted, true);
  assert.equal(state.confirmedDeposits.length, 1);
  assert.equal(state.confirmedDeposits[0].paymentReference, 'TX-001');
});

test('acumula abonos y no activa antes de alcanzar el porcentaje requerido', async () => {
  const { CustomerReceiptService } = await modules();
  const state = fixture();
  const service = new CustomerReceiptService(state);

  const first = await service.create(paymentInput({ amount: 300, paymentReference: 'TX-001' }));
  assert.equal(first.balance.totalPaid, 300);
  assert.equal(first.balance.pendingBalance, 700);
  assert.equal(first.balance.depositCompleted, false);
  assert.equal(state.confirmedDeposits.length, 0);

  const second = await service.create(paymentInput({ amount: 300, paymentReference: 'TX-002' }));
  assert.equal(second.balance.totalPaid, 600);
  assert.equal(second.balance.pendingBalance, 400);
  assert.equal(second.balance.depositCompleted, true);
  assert.equal(state.confirmedDeposits.length, 1);
});

test('rechaza un proyecto que no pertenece a la cotización', async () => {
  const { CustomerReceiptService } = await modules();
  const state = fixture();
  state.adapter.getProjectById = async () => ({ id: 'project-1', quotation_id: 'otra-cotizacion' });
  const service = new CustomerReceiptService(state);

  await assert.rejects(
    () => service.create(paymentInput()),
    (error) => error.code === 'PAYMENT_PROJECT_LINEAGE_INVALID'
  );
});

test('un recibo cancelado no activa el proyecto', async () => {
  const { CustomerReceiptService } = await modules();
  const state = fixture();
  const service = new CustomerReceiptService(state);
  const result = await service.create(paymentInput({ status: 'cancelled' }));

  assert.equal(result.payment.status, 'cancelled');
  assert.equal(state.confirmedDeposits.length, 0);
});
