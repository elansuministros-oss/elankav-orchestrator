'use strict';

const { createClient } = require('../adapters/crmWriteAdapter');
const { normalizeWhatsappE164 } = require('./phoneService');
const normalize = value => String(value || '').trim();
const normalizePlatform = value => normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function normalizeClientInput(input = {}) {
  const name = normalize(input.name);
  const platform = normalizePlatform(input.platform);
  const whatsapp = normalizeWhatsappE164(input.whatsapp || input.phone);

  if (!name) throw Object.assign(new Error('CLIENT_NAME_REQUIRED'), { code: 'CLIENT_NAME_REQUIRED' });
  if (!platform) throw Object.assign(new Error('CLIENT_PLATFORM_REQUIRED'), { code: 'CLIENT_PLATFORM_REQUIRED' });
  if (!whatsapp) throw Object.assign(new Error('CLIENT_WHATSAPP_INVALID'), { code: 'CLIENT_WHATSAPP_INVALID' });

  return {
    name,
    platform,
    contactName: normalize(input.contactName),
    contactRole: normalize(input.contactRole),
    whatsapp,
    phone: normalize(input.phone).replace(/\D/g, ''),
    email: normalize(input.email).toLowerCase(),
    country: normalize(input.country),
    city: normalize(input.city),
    address: normalize(input.address),
    notes: normalize(input.notes),
    responsibleCommercialId: normalize(input.responsibleCommercialId)
  };
}

async function registerClient(input) {
  const result = await createClient(normalizeClientInput(input));
  return { ok: true, status: result.status, client: result.client };
}

module.exports = { normalizePlatform, normalizeClientInput, registerClient };
