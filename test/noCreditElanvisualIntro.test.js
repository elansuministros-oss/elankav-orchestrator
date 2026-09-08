'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {buildDeterministicCustomerFallback}=require('../services/openaiService');

test('no-credit fallback answers what ELANVISUAL is instead of generic sales prompt',()=>{
  const reply=buildDeterministicCustomerFallback({input:'Qué es ELANVISUAL ??',context:{}});
  assert.match(reply,/ELANVISUAL/i);
  assert.match(reply,/comunicaci[oó]n visual|r[oó]tulos|fachadas/i);
  assert.doesNotMatch(reply,/Contame qué producto o trabajo necesitás/i);
});
