'use strict';

const { readContext, updateContext } = require('./ownerBusinessContextService');
const {
  listQuotations,
  searchCustomers
} = require('./ownerBusinessConnectClient');
const ownerQuotationMediaService = require('./ownerQuotationMediaService');

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function stripHonorific(value) {
  return String(value || '')
    .replace(/^(?:la|el)\s+/i, '')
    .replace(/^(?:dra\.?|dr\.?|sra\.?|sr\.?|arq\.?)\s+/i, '')
    .trim();
}

function customerId(customer) {
  return String(customer?.customerId || customer?.id || '').trim();
}

function customerIdOfQuotation(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return String(row?.customer_id || row?.customerId || publicDocument?.customer?.customerId || '').trim();
}

function projectIdOfQuotation(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return String(row?.project_id || row?.projectId || publicDocument?.project?.projectId || '').trim();
}

function quotationIdOfQuotation(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return String(row?.quotation_id || row?.quotationId || row?.id || publicDocument?.quotation?.quotationId || '').trim();
}

function quotationNumberOfQuotation(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return String(row?.quotation_number || row?.quotationNumber || publicDocument?.quotation?.quotationNumber || '').trim();
}

function quotationPublicUrl(row) {
  return String(row?.public_url || row?.publicUrl || '').trim();
}

function quotationStatus(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return normalize(row?.status || row?.quotation_status || publicDocument?.quotation?.status || '');
}

function quotationItems(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return Array.isArray(publicDocument.items) ? publicDocument.items : (Array.isArray(row?.items) ? row.items : []);
}

function hasItemReference(row, reference) {
  if (!reference) return false;
  const wanted = normalize(reference);
  return quotationItems(row)
    .filter(item => normalize(item?.source) !== 'logistics_library')
    .some(item => {
      const label = normalize(`${item?.title || ''} ${item?.description || ''} ${item?.name || ''}`);
      return label.includes(wanted) || wanted.includes(label);
    });
}

function normalizeQuotationRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.quotations)) return payload.data.quotations;
  if (Array.isArray(payload?.quotations)) return payload.quotations;
  if (Array.isArray(payload)) return payload;
  return [];
}

function matchingCustomers(rows, reference) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .map(row => row?.customer || row)
    .filter(Boolean);
  const wanted = normalize(stripHonorific(reference));
  const exact = candidates.filter(customer => {
    const names = [customer?.name, customer?.companyName, customer?.displayName]
      .filter(Boolean)
      .map(name => normalize(stripHonorific(name)));
    return names.some(name => name === wanted);
  });
  return exact.length ? exact : candidates;
}

async function resolveHomonymousQuotation(request) {
  if (!request?.customerReference || !request?.anchorReference) return null;

  const customerResponse = await searchCustomers(request.customerReference);
  const customerRows = customerResponse?.data?.results || [];
  const customers = matchingCustomers(customerRows, request.customerReference);
  if (customers.length < 2) return null;

  const ids = new Set(customers.map(customerId).filter(Boolean));
  if (ids.size < 2) return null;

  const quotationsResponse = await listQuotations();
  let candidates = normalizeQuotationRows(quotationsResponse)
    .filter(row => ids.has(customerIdOfQuotation(row)) && quotationStatus(row) === 'draft');

  const anchored = candidates.filter(row => hasItemReference(row, request.anchorReference));
  if (anchored.length) candidates = anchored;

  if (candidates.length > 1) {
    const context = await readContext();
    if (context.activeProjectId) {
      const active = candidates.filter(row => projectIdOfQuotation(row) === String(context.activeProjectId));
      if (active.length === 1) candidates = active;
    }
  }

  if (candidates.length !== 1) return null;

  const row = candidates[0];
  const projectId = projectIdOfQuotation(row);
  const quotationId = quotationIdOfQuotation(row);
  if (!projectId || !quotationId) return null;

  await updateContext({
    activeCustomerId: customerIdOfQuotation(row),
    activeQuotationId: quotationId,
    activeQuotationNumber: quotationNumberOfQuotation(row) || null,
    activeQuotationPublicUrl: quotationPublicUrl(row) || null,
    activeProjectId: projectId,
    lastEntityType: 'quotation',
    lastEntityId: quotationId
  });

  return {
    projectId,
    quotationId,
    customerId: customerIdOfQuotation(row)
  };
}

function isCustomerAmbiguity(result) {
  return result?.status === 'clarification_required' &&
    /encontre varios clientes|encontré varios clientes/i.test(String(result?.outputText || ''));
}

async function addItemByHumanReference(request) {
  const first = await ownerQuotationMediaService.addItemByHumanReference(request);
  if (!isCustomerAmbiguity(first)) return first;

  const resolved = await resolveHomonymousQuotation(request);
  if (!resolved) return first;

  return ownerQuotationMediaService.addItemByHumanReference({
    ...request,
    customerReference: ''
  });
}

module.exports = {
  addItemByHumanReference,
  hasItemReference,
  isCustomerAmbiguity,
  matchingCustomers,
  resolveHomonymousQuotation
};
