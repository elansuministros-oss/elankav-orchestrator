'use strict';

const CONNECT_BASE_URL = String(
  process.env.ELAN_ONE_CONNECT_BASE_URL || 'http://127.0.0.1:8098'
).trim().replace(/\/+$/, '');

class ProviderServiceCostError extends Error {
  constructor(code, message, details = null, statusCode = 500) {
    super(message);
    this.name = 'ProviderServiceCostError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

async function registerProviderServiceCost(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProviderServiceCostError(
      'ELAN_ONE_PROVIDER_SERVICE_INPUT_REQUIRED',
      'Se requieren los datos del servicio del proveedor.',
      null,
      400
    );
  }

  let response;

  try {
    response = await fetch(
      `${CONNECT_BASE_URL}/api/v1/provider-service-costs/register`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      }
    );
  } catch (cause) {
    throw new ProviderServiceCostError(
      'ELAN_ONE_PROVIDER_SERVICE_CONNECT_UNREACHABLE',
      'No fue posible conectar con CONNECT ELAN ONE.',
      { cause: String(cause?.message || cause || '') },
      503
    );
  }

  const raw = await response.text();
  let payload = {};

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ProviderServiceCostError(
        'ELAN_ONE_PROVIDER_SERVICE_INVALID_RESPONSE',
        'CONNECT ELAN ONE devolvió una respuesta inválida.',
        { status: response.status, raw },
        502
      );
    }
  }

  if (!response.ok) {
    const nested =
      payload && typeof payload.error === 'object'
        ? payload.error
        : {};

    throw new ProviderServiceCostError(
      String(
        nested.code ||
        payload.code ||
        'ELAN_ONE_PROVIDER_SERVICE_CONNECT_ERROR'
      ),
      String(
        nested.message ||
        payload.message ||
        'CONNECT ELAN ONE rechazó el servicio.'
      ),
      {
        status: response.status,
        response: payload
      },
      response.status
    );
  }

  return {
    ok: true,
    ...payload
  };
}

module.exports = {
  ProviderServiceCostError,
  registerProviderServiceCost
};
