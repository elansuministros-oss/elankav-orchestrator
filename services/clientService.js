'use strict';

const { createClient } = require('../adapters/crmWriteAdapter');

function normalize(value) {
  return String(value || '').trim();
}

function normalizePlatform(value) {
  return normalize(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeClientInput(input = {}) {
  const name = normalize(input.name);
  const platform = normalizePlatform(input.platform);

  if (!name) {
    const error = new Error('CLIENT_NAME_REQUIRED');
    error.code = 'CLIENT_NAME_REQUIRED';
    throw error;
  }

  if (!platform) {
    const error = new Error('CLIENT_PLATFORM_REQUIRED');
    error.code = 'CLIENT_PLATFORM_REQUIRED';
    throw error;
  }

  return {
    name,
    platform,
    responsibleCommercialId: normalize(input.responsibleCommercialId),
    phone: normalize(input.phone),
    email: normalize(input.email),
    country: normalize(input.country),
    city: normalize(input.city),
    notes: normalize(input.notes)
  };
}

async function registerClient(input) {
  const client = normalizeClientInput(input);
  const result = await createClient(client);

  return {
    ok: true,
    status: result.status,
    client: result.client
  };
}

module.exports = {
  normalizePlatform,
  normalizeClientInput,
  registerClient
};
