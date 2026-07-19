'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  handleVqsCustomerPaymentsApi,
  matchRoute
} = require('../api/vqsCustomerPaymentsApi');

function request({ method = 'GET', url, body, headers = {} }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.destroy = () => {};
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function responseCapture() {
  const state = { status: null, payload: null, headers: {} };
  return {
    state,
    res: {
      setHeader(name, value) { state.headers[name] = value; }
    },
    sendJson(_res, status, payload) {
      state.status = status;
      state.payload = payload;
    }
  };
}

function authenticated() {
  return {
    type: 'user',
    userId: 'user-1',
    role: 'owner',
    executiveId: 'executive-1',
    platformId: 'ELANVISUAL'
  };
}

test('reconoce colección y detalle de pagos por proyecto', () => {
  assert.deepEqual(matchRoute('/api/vqs/projects/project-1/payments'), {
    projectId: 'project-1',
    paymentId: ''
  });
  assert.deepEqual(matchRoute('/api/vqs/projects/project-1/payments/payment-1'), {
    projectId: 'project-1',
    paymentId: 'payment-1'
  });
  assert.equal(matchRoute('/api/vqs/projects/project-1/work-orders'), null);
});

test('POST registra un pago usando el projectId de la ruta y actor autenticado', async () => {
  const capture = responseCapture();
  const calls = [];
  const handled = await handleVqsCustomerPaymentsApi({
    req: request({
      method: 'POST',
      url: '/api/vqs/projects/project-1/payments',
      body: { projectId: 'project-falso', quotationId: 'quotation-1', amount: 600, currency: 'USD', paymentMethod: 'transfer' }
    }),
    res: capture.res,
    sendJson: capture.sendJson,
    authenticate: async () => authenticated(),
    services: {
      supabase: {},
      paymentAdapter: {},
      receiptService: {
        async create(input, actor) {
          calls.push({ input, actor });
          return { payment: { id: 'payment-1' }, balance: { depositCompleted: true } };
        }
      }
    }
  });

  assert.equal(handled, true);
  assert.equal(capture.state.status, 201);
  assert.equal(calls[0].input.projectId, 'project-1');
  assert.equal(calls[0].actor.userId, 'user-1');
  assert.equal(capture.state.payload.data.balance.depositCompleted, true);
});

test('GET lista pagos del proyecto con filtros limitados', async () => {
  const capture = responseCapture();
  const calls = [];
  await handleVqsCustomerPaymentsApi({
    req: request({ method: 'GET', url: '/api/vqs/projects/project-1/payments?status=confirmed&limit=500' }),
    res: capture.res,
    sendJson: capture.sendJson,
    authenticate: async () => authenticated(),
    services: {
      supabase: {},
      receiptService: {},
      paymentAdapter: {
        async listCustomerPayments(filters) {
          calls.push(filters);
          return [{ id: 'payment-1', project_id: 'project-1' }];
        }
      }
    }
  });

  assert.equal(capture.state.status, 200);
  assert.equal(capture.state.payload.count, 1);
  assert.deepEqual(calls[0], { projectId: 'project-1', statuses: ['confirmed'], limit: 200 });
});

test('GET detalle no permite leer un pago de otro proyecto', async () => {
  const capture = responseCapture();
  await handleVqsCustomerPaymentsApi({
    req: request({ method: 'GET', url: '/api/vqs/projects/project-1/payments/payment-1' }),
    res: capture.res,
    sendJson: capture.sendJson,
    authenticate: async () => authenticated(),
    services: {
      supabase: {},
      receiptService: {},
      paymentAdapter: {
        async getCustomerPaymentById() { return { id: 'payment-1', project_id: 'project-2' }; }
      }
    }
  });

  assert.equal(capture.state.status, 404);
  assert.equal(capture.state.payload.code, 'CUSTOMER_PAYMENT_NOT_FOUND');
});

test('propaga 401 cuando falta autenticación', async () => {
  const capture = responseCapture();
  await handleVqsCustomerPaymentsApi({
    req: request({ method: 'GET', url: '/api/vqs/projects/project-1/payments' }),
    res: capture.res,
    sendJson: capture.sendJson,
    authenticate: async () => {
      const error = new Error('Autenticación requerida');
      error.code = 'AUTH_REQUIRED';
      error.statusCode = 401;
      throw error;
    },
    services: { supabase: {}, receiptService: {}, paymentAdapter: {} }
  });

  assert.equal(capture.state.status, 401);
  assert.equal(capture.state.payload.code, 'AUTH_REQUIRED');
});