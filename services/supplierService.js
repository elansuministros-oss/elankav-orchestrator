'use strict';

const { createSupplier } = require('../adapters/crmWriteAdapter');
const TYPES = new Set(['materials', 'services', 'mixed']);
const normalize = value => String(value || '').trim();

function normalizeSupplierInput(input = {}) {
  const name = normalize(input.name);
  const supplierType = normalize(input.supplierType).toLowerCase();
  const categories = Array.isArray(input.categories)
    ? input.categories.map(normalize).filter(Boolean)
    : [];
  if (!name) throw Object.assign(new Error('SUPPLIER_NAME_REQUIRED'), { code: 'SUPPLIER_NAME_REQUIRED' });
  if (!TYPES.has(supplierType)) throw Object.assign(new Error('SUPPLIER_TYPE_INVALID'), { code: 'SUPPLIER_TYPE_INVALID' });
  return { name, supplierType, categories };
}

async function registerSupplier(input) {
  const result = await createSupplier(normalizeSupplierInput(input));
  return { ok: true, status: result.status, supplier: result.supplier };
}

module.exports = { normalizeSupplierInput, registerSupplier };
