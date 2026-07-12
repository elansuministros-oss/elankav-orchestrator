'use strict';

function normalize(value) { return String(value || '').trim(); }

function getConfig() {
  const url = normalize(process.env.CRM_API_URL);
  const token = normalize(process.env.CRM_INTERNAL_TOKEN);
  if (!url || !token) {
    const error = new Error('CRM_WRITE_NOT_CONFIGURED');
    error.code = 'CRM_WRITE_NOT_CONFIGURED';
    throw error;
  }
  return { url, token };
}

function getContactUrl(url) {
  return url.replace(/\/api\/crm\/?$/, '/api/crm-contact');
}

async function request(url, token, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || `CRM_WRITE_HTTP_${response.status}`);
    error.code = data?.error || 'CRM_WRITE_REQUEST_FAILED';
    error.status = response.status;
    error.crmStatus = data?.status || null;
    error.details = data;
    throw error;
  }
  return data;
}

async function requestCrmWrite(payload) {
  const { url, token } = getConfig();
  return request(url, token, payload);
}

async function requestContactWrite(payload) {
  const { url, token } = getConfig();
  return request(getContactUrl(url), token, payload);
}

const createSupplier = payload => requestCrmWrite({ action: 'create_supplier', ...payload });
const createClient = payload => requestCrmWrite({ action: 'create_client', ...payload });
const findSupplier = name => requestContactWrite({ action: 'find_supplier', name });
const listContacts = identityId => requestContactWrite({ action: 'list_contacts', identityId });
const addContact = payload => requestContactWrite({ action: 'add_contact', ...payload });
const updateContact = payload => requestContactWrite({ action: 'update_contact', ...payload });

module.exports = {
  getConfig,
  getContactUrl,
  requestCrmWrite,
  requestContactWrite,
  createSupplier,
  createClient,
  findSupplier,
  listContacts,
  addContact,
  updateContact
};
