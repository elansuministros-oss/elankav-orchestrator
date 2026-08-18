'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  providerMatchesPhone,
  resolveRegisteredProvider
} = require('../services/providerInboundIntelligenceService');

test('PROVIDER-INBOUND-IDENTITY-01 matches provider official phone when whatsapp is empty', () => {
  assert.equal(providerMatchesPhone({ status: 'active', phone: '+505 7872 7534', whatsapp: null }, '50578727534'), true);
});

test('PROVIDER-INBOUND-IDENTITY-01 falls back to active directory when indexed search misses phone field', async () => {
  const calls = [];
  const provider = {
    id: 'provider-play-marketing',
    tradeName: 'PLAY MARKETING',
    status: 'active',
    whatsapp: null,
    phone: '+505 7872 7534'
  };

  const fetchImpl = async (url) => {
    calls.push(String(url));
    const rows = String(url).includes('search=') ? [] : [provider];
    return {
      ok: true,
      async json() { return rows; }
    };
  };

  const result = await resolveRegisteredProvider({ phone: '50578727534', fetchImpl });
  assert.equal(result?.id, provider.id);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /search=50578727534/);
  assert.doesNotMatch(calls[1], /search=/);
});

test('PROVIDER-INBOUND-IDENTITY-01 never matches inactive provider', () => {
  assert.equal(providerMatchesPhone({ status: 'inactive', phone: '50578727534' }, '50578727534'), false);
});
