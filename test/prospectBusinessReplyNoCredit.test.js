'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildDeterministicCustomerFallback}=require('../services/openaiService');

test('no-credit prospect business autoresponse continues ELANVISUAL outreach',()=>{
  const reply=buildDeterministicCustomerFallback({
    input:'Gracias por comunicarte con la Universidad de Medicina Oriental. ¿Cómo podemos ayudarte?',
    context:{platform:'ELANVISUAL'}
  });
  assert.match(reply,/ELANVISUAL/i);
  assert.match(reply,/(mercadeo|compras|imagen|rotul|visual)/i);
  assert.doesNotMatch(reply,/qué producto o trabajo necesitás/i);
});
