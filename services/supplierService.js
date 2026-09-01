'use strict';

const { createSupplier } = require('../adapters/crmWriteAdapter');
const { normalizeWhatsappE164 } = require('./phoneService');
const TYPES = new Set(['materials', 'services', 'mixed']);
const normalize = value => String(value || '').trim();
const normalizePhone = value => normalize(value).replace(/\D/g, '');

function normalizeSupplierInput(input = {}) {
  const name = normalize(input.name);
  const supplierType = normalize(input.supplierType).toLowerCase();
  const categories = Array.isArray(input.categories)
    ? input.categories.map(normalize).filter(Boolean)
    : [];
  const whatsapp = normalizeWhatsappE164(input.whatsapp || input.phone);

  if (!name) throw Object.assign(new Error('SUPPLIER_NAME_REQUIRED'), { code: 'SUPPLIER_NAME_REQUIRED' });
  if (!TYPES.has(supplierType)) throw Object.assign(new Error('SUPPLIER_TYPE_INVALID'), { code: 'SUPPLIER_TYPE_INVALID' });
  if (!whatsapp) throw Object.assign(new Error('SUPPLIER_WHATSAPP_INVALID'), { code: 'SUPPLIER_WHATSAPP_INVALID' });

  return {
    name,
    supplierType,
    categories,
    contactName: normalize(input.contactName),
    contactRole: normalize(input.contactRole),
    whatsapp,
    phone: normalizePhone(input.phone),
    email: normalize(input.email).toLowerCase(),
    country: normalize(input.country),
    city: normalize(input.city),
    address: normalize(input.address),
    commercialTerms: normalize(input.commercialTerms),
    notes: normalize(input.notes)
  };
}

async function registerSupplier(input) {
  const result = await createSupplier(normalizeSupplierInput(input));
  return { ok: true, status: result.status, supplier: result.supplier };
}

module.exports = { normalizeSupplierInput, registerSupplier };
