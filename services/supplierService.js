'use strict';

const { createSupplier } = require('../adapters/crmWriteAdapter');

const SUPPLIER_TYPES = new Set(['materials', 'services', 'mixed']);

function normalize(value) {
  return String(value || '').trim();
}

function normalizeSupplierInput(input = {}) {
  const name = normalize(input.name);
  const supplierType = normalize(input.supplierType).toLowerCase();
  const categories = Array.isArray(input.categories)
    ? input.categories.map(normalize).filter(Boolean)
    : [];

  if (!name) {
    const error = new Error('SUPPLIER_NAME_REQUIRED');
    error.code = 'SUPPLIER_NAME_REQUIRED';
    throw error;
  }

  if (!SUPPLIER_TYPES.has(supplierType)) {
    const error = new Error('SUPPLIER_TYPE_INVALID');
    error.code = 'SUPPLIER_TYPE_INVALID';
    throw error;
  }

  return {
    name,
    supplierType,
    categories,
    contactName: normalize(input.contactName),
    phone: normalize(input.phone),
    email: normalize(input.email),
    country: normalize(input.country),
    city: normalize(input.city),
    commercialTerms: normalize(input.commercialTerms),
    notes: normalize(input.notes),
    forceCreate: input.forceCreate === true
  };
}

async function registerSupplier(input) {
  const supplier = normalizeSupplierInput(input);
  const result = await createSupplier(supplier);

  return {
    ok: true,
    status: result.status,
    supplier: result.supplier
  };
}

module.exports = {
  normalizeSupplierInput,
  registerSupplier
};
