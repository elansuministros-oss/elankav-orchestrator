'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMMAND_TYPE,
  detectOwnerSellerReadCommand,
  executeOwnerSellerReadCommand
} = require('../services/ownerSellerReadService');

test('detects seller list requests without intercepting seller writes', () => {
  assert.deepEqual(
    detectOwnerSellerReadCommand('ELAN dame la lista de vendedores'),
    { type: COMMAND_TYPE, action: 'list' }
  );
  assert.deepEqual(
    detectOwnerSellerReadCommand('Muéstrame los vendedores'),
    { type: COMMAND_TYPE, action: 'list' }
  );
  assert.equal(detectOwnerSellerReadCommand('ELAN registra una vendedora'), null);
  assert.equal(detectOwnerSellerReadCommand('ELAN genera acceso para la vendedora Valentina en ELANVISUAL'), null);
});

test('detects seller search by human name', () => {
  assert.deepEqual(
    detectOwnerSellerReadCommand('ELAN busca la vendedora Valentina Yahosca Ramos Mena'),
    { type: COMMAND_TYPE, action: 'search', query: 'valentina yahosca ramos mena' }
  );
});

test('lists authoritative sellers returned by CONNECT', async () => {
  const result = await executeOwnerSellerReadCommand(
    { type: COMMAND_TYPE, action: 'list' },
    {
      listSellers: async () => ({
        data: {
          sellers: [
            {
              id: 'seller-1',
              seller_code: 'VALENTINA-001',
              display_name: 'Valentina Yahosca Ramos Mena',
              whatsapp: '+50582121495',
              status: 'active',
              platforms: [{ platform: 'ELANVISUAL', status: 'active' }]
            }
          ]
        }
      })
    }
  );

  assert.equal(result.handled, true);
  assert.equal(result.result.count, 1);
  assert.match(result.outputText, /Valentina Yahosca Ramos Mena/);
  assert.match(result.outputText, /VALENTINA-001/);
  assert.match(result.outputText, /ELANVISUAL/);
  assert.match(result.outputText, /crm_sellers \+ crm_seller_platforms/);
});

test('searches authoritative sellers by name and reports not found without creating anything', async () => {
  const listSellers = async () => ({
    data: {
      sellers: [
        { seller_code: 'VALENTINA-001', display_name: 'Valentina Yahosca Ramos Mena', whatsapp: '+50582121495', status: 'active' },
        { seller_code: 'ANA-002', display_name: 'Ana Pérez', whatsapp: '+50588888888', status: 'active' }
      ]
    }
  });

  const found = await executeOwnerSellerReadCommand(
    { type: COMMAND_TYPE, action: 'search', query: 'Valentina Yahosca' },
    { listSellers }
  );
  assert.equal(found.result.count, 1);
  assert.match(found.outputText, /Valentina Yahosca Ramos Mena/);

  const missing = await executeOwnerSellerReadCommand(
    { type: COMMAND_TYPE, action: 'search', query: 'No Existe' },
    { listSellers }
  );
  assert.equal(missing.result.count, 0);
  assert.match(missing.outputText, /No encontré un vendedor oficial/);
});
