'use strict';

const { createClient } = require('../adapters/crmWriteAdapter');
const normalize = value => String(value || '').trim();
const normalizePlatform = value => normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function normalizeClientInput(input = {}) {
  const name = normalize(input.name);
  const platform = normalizePlatform(input.platform);
  if (!name) throw Object.assign(new Error('CLIENT_NAME_REQUIRED'), { code: 'CLIENT_NAME_REQUIRED' });
  if (!platform) throw Object.assign(new Error('CLIENT_PLATFORM_REQUIRED'), { code: 'CLIENT_PLATFORM_REQUIRED' });
  return {
    name,
    platform,
    phone: normalize(input.phone),
    responsibleCommercialId: normalize(input.responsibleCommercialId)
  };
}

async function registerClient(input) {
  const result = await createClient(normalizeClientInput(input));
  return { ok: true, status: result.status, client: result.client };
}

module.exports = { normalizePlatform, normalizeClientInput, registerClient };
