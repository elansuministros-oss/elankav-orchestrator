'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { classifyInboundCommercialRelationship }=require('../services/inboundCommercialRoleService');

test('texto para enviar cotizacion de materiales se clasifica como provider_candidate',()=>{
  const r=classifyInboundCommercialRelationship({
    message:'Erick Antonio Cano me compartió su contacto para enviar la cotización de láminas lisa',
    actor:null
  });
  assert.equal(r.kind,'provider_candidate');
});

test('PDF comercial de desconocido no debe terminar en aclaracion cliente/proveedor',()=>{
  const r=classifyInboundCommercialRelationship({
    message:'[Archivo recibido: Cotizacion de Andamios Erick Cano 07-09-26.pdf]',
    actor:{ role:'provider_candidate', resolutionStatus:'found' }
  });
  assert.equal(r.kind,'provider_candidate');
});
