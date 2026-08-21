'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQuotationDocument,
  isCreateFollowUp,
  isLinkFollowUp,
  isSendFollowUp,
  parseCustomerIdentity,
  parseMeasurements,
  quotationIntent
} = require('../services/sellerConversationRuntimeService');

test('parses Juan five window measurements', () => {
  const measures = parseMeasurements('0.69*2.35\n0.98*0.29\n0.88*1.92\n1.16x2.35\n1.16x2.35');
  assert.equal(measures.length, 5);
  assert.deepEqual(measures[0], { width: 0.69, height: 2.35, quantity: 1 });
  assert.deepEqual(measures[4], { width: 1.16, height: 2.35, quantity: 1 });
});

test('extracts product and Altamira from natural seller request', () => {
  const intent = quotationIntent('Necesito cotizar vinil fros, para la rotulación de unas ventanas, el local queda en altamira');
  assert.ok(intent);
  assert.equal(intent.productQuery.toLowerCase(), 'vinil fros');
  assert.equal(intent.location.toLowerCase(), 'altamira');
});

test('extracts Omar Valverde and Nicaragua WhatsApp', () => {
  const identity = parseCustomerIdentity('Nombre del cliente Omar Valverde\n85148074 claro');
  assert.deepEqual(identity, {
    name: 'Omar Valverde',
    phone: '+50585148074',
    whatsapp: '+50585148074'
  });
});

test('recognizes short operational follow-ups', () => {
  assert.equal(isCreateFollowUp('Creala'), true);
  assert.equal(isLinkFollowUp('Mándame el link de la cotización para verificar'), true);
  assert.equal(isSendFollowUp('mandásela'), true);
});

test('builds one officially-priced item per physical measurement', () => {
  const pending = {
    productQuery: 'vinil frost',
    location: 'Altamira',
    measurements: parseMeasurements('0.69*2.35\n0.98*0.29\n0.88*1.92\n1.16x2.35\n1.16x2.35')
  };
  const customer = {
    customerId: 'customer-1',
    name: 'Omar Valverde',
    phone: '+50585148074'
  };
  const actor = {
    role: 'seller',
    sellerId: 'seller-juan',
    displayName: 'Juan Ruiz'
  };
  const document = buildQuotationDocument({ pending, customer, actor });
  assert.equal(document.items.length, 5);
  assert.equal(document.items[0].pricingQuery, 'vinil frost');
  assert.deepEqual(document.items[0].dimensions, { width: 0.69, height: 2.35 });
  assert.deepEqual(document.items[4].dimensions, { width: 1.16, height: 2.35 });
  assert.equal(document.relations.customerId, 'customer-1');
  assert.equal(document.relations.sellerId, 'seller-juan');
  assert.equal(document.executiveSnapshot.name, 'Juan Ruiz');
});
