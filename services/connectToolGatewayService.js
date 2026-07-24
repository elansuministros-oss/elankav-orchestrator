'use strict';

const { ConnectClient } = require('../adapters/connectClient');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OPERATIONS = Object.freeze({
  'customers.list': {
    permission: 'connect:customers:read',
    method: 'GET',
    path: () => '/api/v1/business/parties',
    query: () => ({ type: 'customer' })
  },
  'customers.create': {
    permission: 'connect:customers:write',
    method: 'POST',
    path: () => '/api/v1/business/parties',
    body: input => ({ ...requireObject(input), type: 'customer' })
  },
  'suppliers.list': {
    permission: 'connect:suppliers:read',
    method: 'GET',
    path: () => '/api/v1/business/parties',
    query: () => ({ type: 'supplier' })
  },
  'suppliers.create': {
    permission: 'connect:suppliers:write',
    method: 'POST',
    path: () => '/api/v1/business/parties',
    body: input => ({ ...requireObject(input), type: 'supplier' })
  },
  'leads.list': {
    permission: 'connect:leads:read',
    method: 'GET',
    path: () => '/api/v1/leads',
    query: input => pickQuery(input, [
      'status', 'priority', 'platform', 'assignedExecutive', 'search'
    ])
  },
  'leads.get': {
    permission: 'connect:leads:read',
    method: 'GET',
    path: input => `/api/v1/leads/${requireUuid(input, 'leadId')}`
  },
  'leads.create': {
    permission: 'connect:leads:write',
    method: 'POST',
    path: () => '/api/v1/leads',
    body: requireObject
  },
  'opportunities.list': {
    permission: 'connect:opportunities:read',
    method: 'GET',
    path: () => '/api/v1/opportunities',
    query: input => pickQuery(input, [
      'leadId', 'stage', 'platform', 'assignedExecutive', 'search'
    ])
  },
  'opportunities.get': {
    permission: 'connect:opportunities:read',
    method: 'GET',
    path: input => `/api/v1/opportunities/${requireUuid(input, 'opportunityId')}`
  },
  'opportunities.create': {
    permission: 'connect:opportunities:write',
    method: 'POST',
    path: () => '/api/v1/opportunities',
    body: requireObject
  },
  'opportunities.update': {
    permission: 'connect:opportunities:write',
    method: 'PATCH',
    path: input => `/api/v1/opportunities/${requireUuid(input, 'opportunityId')}`,
    body: input => withoutIds(input)
  },
  'quotes.list': {
    permission: 'connect:quotes:read',
    method: 'GET',
    path: () => '/api/v1/quotes',
    query: input => pickQuery(input, [
      'opportunityId', 'leadId', 'status', 'platform', 'quoteNumber'
    ])
  },
  'quotes.get': {
    permission: 'connect:quotes:read',
    method: 'GET',
    path: input => `/api/v1/quotes/${requireUuid(input, 'quoteId')}`
  },
  'quotes.create': {
    permission: 'connect:quotes:write',
    method: 'POST',
    path: () => '/api/v1/quotes',
    body: requireObject
  },
  'quotes.create-from-opportunity': {
    permission: 'connect:quotes:write',
    method: 'POST',
    path: input => (
      `/api/v1/opportunities/${requireUuid(input, 'opportunityId')}/quotes`
    ),
    body: input => withoutIds(input)
  },
  'quotes.update': {
    permission: 'connect:quotes:write',
    method: 'PATCH',
    path: input => `/api/v1/quotes/${requireUuid(input, 'quoteId')}`,
    body: input => withoutIds(input)
  },
  'quotes.change-status': {
    permission: 'connect:quotes:write',
    method: 'PATCH',
    path: input => `/api/v1/quotes/${requireUuid(input, 'quoteId')}/status`,
    body: input => withoutIds(input)
  },
  'orders.list': {
    permission: 'connect:orders:read',
    method: 'GET',
    path: () => '/api/v1/orders',
    query: input => pickQuery(input, [
      'quoteId',
      'opportunityId',
      'leadId',
      'status',
      'platform',
      'orderNumber',
      'paymentStatus',
      'productionStatus',
      'fulfillmentStatus'
    ])
  },
  'orders.get': {
    permission: 'connect:orders:read',
    method: 'GET',
    path: input => `/api/v1/orders/${requireUuid(input, 'orderId')}`
  },
  'orders.create-from-quote': {
    permission: 'connect:orders:write',
    method: 'POST',
    path: input => `/api/v1/quotes/${requireUuid(input, 'quoteId')}/orders`,
    body: input => withoutIds(input)
  },
  'orders.change-status': {
    permission: 'connect:orders:write',
    method: 'PATCH',
    path: input => `/api/v1/orders/${requireUuid(input, 'orderId')}/status`,
    body: input => withoutIds(input)
  }
});

function gatewayError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requireObject(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw gatewayError('CONNECT_TOOL_INPUT_INVALID');
  }
  return { ...value };
}

function requireUuid(input, field) {
  const value = String(requireObject(input)[field] || '').trim();
  if (!UUID_PATTERN.test(value)) {
    throw gatewayError(`CONNECT_TOOL_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function pickQuery(input, allowed) {
  const source = requireObject(input);
  return Object.fromEntries(
    allowed
      .filter(key => source[key] !== undefined)
      .map(key => [key, source[key]])
  );
}

function withoutIds(input) {
  const body = requireObject(input);
  delete body.leadId;
  delete body.opportunityId;
  delete body.quoteId;
  delete body.orderId;
  return body;
}

function hasPermission(permissions, required) {
  const granted = new Set(
    Array.isArray(permissions)
      ? permissions.map(value => String(value || '').trim()).filter(Boolean)
      : []
  );
  return granted.has(required) || granted.has('connect:*');
}

class ConnectToolGatewayService {
  constructor({ client = new ConnectClient() } = {}) {
    if (!client || typeof client.request !== 'function') {
      throw new TypeError('CONNECT_CLIENT_REQUIRED');
    }
    this.client = client;
  }

  async execute({ operation, input = {}, permissions = [], mode = 'active' } = {}) {
    const normalizedOperation = String(operation || '').trim().toLowerCase();
    const definition = OPERATIONS[normalizedOperation];

    if (!definition) {
      throw gatewayError('CONNECT_TOOL_OPERATION_INVALID');
    }
    if (String(mode || '').trim().toLowerCase() !== 'active') {
      throw gatewayError('CONNECT_TOOL_ACTIVE_MODE_REQUIRED', 409);
    }
    if (!hasPermission(permissions, definition.permission)) {
      throw gatewayError('CONNECT_TOOL_PERMISSION_DENIED', 403);
    }

    const request = {
      method: definition.method,
      path: definition.path(input)
    };
    if (definition.query) request.query = definition.query(input);
    if (definition.body) request.body = definition.body(input);

    const data = await this.client.request(request);
    return Object.freeze({
      operation: normalizedOperation,
      permission: definition.permission,
      method: definition.method,
      data
    });
  }
}

module.exports = {
  ConnectToolGatewayService,
  OPERATIONS,
  UUID_PATTERN,
  gatewayError,
  hasPermission
};
