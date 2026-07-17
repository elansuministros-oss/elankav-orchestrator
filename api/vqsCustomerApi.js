'use strict';

const { searchClients } = require('../adapters/crmReadAdapter');

const ROUTE = '/api/vqs/customers/search';

function pathnameOf(url = '') {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return String(url).split('?')[0];
  }
}

async function handleVqsCustomerApi({ req, res, sendJson } = {}) {
  if (pathnameOf(req?.url) !== ROUTE) return false;

  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    sendJson(res, 405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Método no permitido' });
    return true;
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const query = String(url.searchParams.get('q') || '').trim();
    if (query.length < 2) {
      sendJson(res, 422, { success: false, code: 'CRM_CLIENT_QUERY_TOO_SHORT', error: 'Escriba al menos dos caracteres' });
      return true;
    }

    const clients = await searchClients({
      query,
      platform: url.searchParams.get('platform') || 'elanvisual',
      limit: url.searchParams.get('limit') || 12
    });

    sendJson(res, 200, {
      success: true,
      data: clients.map((client) => ({
        type: 'customer',
        sourceId: client.customerId,
        label: client.name,
        customer: client,
        source: { type: 'customer', sourceId: client.customerId }
      }))
    });
  } catch (error) {
    console.error('[VQS_CUSTOMER_API_ERROR]', error?.code || error?.message || 'UNKNOWN_ERROR');
    sendJson(res, error?.status === 422 ? 422 : 502, {
      success: false,
      code: error?.code || 'CRM_CLIENT_SEARCH_ERROR',
      error: 'No fue posible buscar clientes en CRM'
    });
  }

  return true;
}

module.exports = { handleVqsCustomerApi, pathnameOf, ROUTE };
