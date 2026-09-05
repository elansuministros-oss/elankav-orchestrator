'use strict';

const { normalizeWhatsappE164 } = require('./phoneService');

const CONNECT_BASE_URL = String(
  process.env.ELAN_ONE_CONNECT_BASE_URL || 'http://127.0.0.1:8098'
).trim().replace(/\/+$/, '');

class SupplierServiceError extends Error {
  constructor(code, message, details = null, statusCode = 500) {
    super(message);
    this.name = 'SupplierServiceError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

const normalize = value => String(value || '').trim();
const normalizePhone = value => normalize(value).replace(/\D/g, '');

function normalizeSupplierInput(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const tradeName = normalize(
    source.tradeName ||
    source.name ||
    source.business_name ||
    source.company_name ||
    source.nombre
  );

  const whatsapp = normalizeWhatsappE164(
    source.contactWhatsApp ||
    source.whatsapp ||
    source.phone ||
    source.telefono ||
    source.mobile
  );

  if (!tradeName) {
    throw new SupplierServiceError(
      'ELAN_ONE_PROVIDER_VALIDATION_ERROR',
      'El proveedor requiere nombre.',
      { field: 'name' },
      400
    );
  }

  if (!whatsapp) {
    throw new SupplierServiceError(
      'ELAN_ONE_PROVIDER_VALIDATION_ERROR',
      'El proveedor requiere WhatsApp válido.',
      { field: 'whatsapp' },
      400
    );
  }

  const declaredType = normalize(source.type || source.providerType || source.supplierType);
  const contactRole = normalize(source.contactRole || source.role || source.cargo);
  const facebook = normalize(source.facebook);
  const notes = [
    normalize(source.notes),
    contactRole ? `Cargo del contacto: ${contactRole}` : '',
    facebook ? `Facebook: ${facebook}` : '',
    declaredType ? `Tipo declarado: ${declaredType}` : ''
  ].filter(Boolean).join('\n');

  const platforms = Array.isArray(source.platforms) && source.platforms.length
    ? source.platforms.map(value => normalize(value).toUpperCase()).filter(Boolean)
    : [normalize(source.platform || 'ELANVISUAL').toUpperCase() || 'ELANVISUAL'];

  const kinds = Array.isArray(source.kinds) && source.kinds.length
    ? source.kinds.map(normalize).filter(Boolean)
    : ['materials_products', 'services_subcontracting'];

  const categories = Array.isArray(source.categories)
    ? source.categories.map(normalize).filter(Boolean)
    : (declaredType ? [declaredType] : []);

  return {
    tradeName,
    legalName: normalize(source.legalName || source.legal_name || tradeName),
    ...(normalize(source.contactName || source.contact || source.contacto)
      ? { contactName: normalize(source.contactName || source.contact || source.contacto) }
      : {}),
    contactWhatsApp: whatsapp,
    phone: normalizePhone(source.phone || source.whatsapp || whatsapp),
    ...(normalize(source.email) ? { email: normalize(source.email).toLowerCase() } : {}),
    country: normalize(source.country || 'Nicaragua') || 'Nicaragua',
    ...(normalize(source.city) ? { city: normalize(source.city) } : {}),
    ...(normalize(source.address) ? { address: normalize(source.address) } : {}),
    ...((normalize(source.website) || facebook)
      ? { website: normalize(source.website) || facebook }
      : {}),
    currency: normalize(source.currency || 'USD').toUpperCase() || 'USD',
    status: 'active',
    platforms,
    kinds,
    categories,
    ...(notes ? { notes } : {})
  };
}

async function registerSupplier(input) {
  const body = normalizeSupplierInput(input);
  let response;

  try {
    response = await fetch(`${CONNECT_BASE_URL}/api/v1/providers`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (cause) {
    throw new SupplierServiceError(
      'ELAN_ONE_PROVIDER_CONNECT_UNREACHABLE',
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
      throw new SupplierServiceError(
        'ELAN_ONE_PROVIDER_INVALID_RESPONSE',
        'CONNECT ELAN ONE devolvió una respuesta inválida.',
        { status: response.status, raw },
        502
      );
    }
  }

  if (!response.ok) {
    const nested = payload && typeof payload.error === 'object' ? payload.error : {};
    throw new SupplierServiceError(
      String(payload.code || nested.code || 'ELAN_ONE_PROVIDER_CONNECT_ERROR'),
      String(nested.message || payload.message || payload.error || 'CONNECT ELAN ONE rechazó el proveedor.'),
      { status: response.status, response: payload },
      response.status
    );
  }

  return { ok: true, ...payload };
}

module.exports = {
  SupplierServiceError,
  normalizeSupplierInput,
  registerSupplier
};
