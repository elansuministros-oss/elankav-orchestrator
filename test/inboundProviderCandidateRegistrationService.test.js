'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {candidateFromInput,upsertInboundProviderCandidate}=require('../services/inboundProviderCandidateRegistrationService');

test('Ferromax se registra desde historial explícito + intención de enviar cotización',()=>{
 const c=candidateFromInput({message:'Erick Antonio Cano me compartió su contacto para enviar la cotización de láminas lisa',phone:'50584937395',metadata:{connectDecision:{history:[{content:'Buenas tardes\nLe saluda Luis Jarquin\nDe ferromax huembes'}]}}});
 assert.equal(c.tradeName,'ferromax huembes'); assert.equal(c.contactName,'Luis Jarquin'); assert.equal(c.whatsapp,'50584937395'); assert.deepEqual(c.kinds,['materials_products']);
});

test('Alquichevez se registra desde PDF comercial + nombre WhatsApp',()=>{
 const c=candidateFromInput({message:'[Archivo recibido: Cotizacion de Andamios Erick Cano 07-09-26.pdf]',phone:'50585854070',metadata:{whatsappName:'Alquichevez',messageType:'document',media:{filename:'Cotizacion de Andamios Erick Cano 07-09-26.pdf'}}});
 assert.equal(c.tradeName,'Alquichevez'); assert.deepEqual(c.kinds,['services_subcontracting']);
});

test('upsert usa el proveedor maduro de CONNECT',async()=>{
 let call=null;
 const provider=await upsertInboundProviderCandidate({message:'Para enviar la cotización de láminas lisa',phone:'50584937395',metadata:{connectDecision:{history:[{content:'Le saluda Luis Jarquin\nDe Ferromax Huembes'}]}}},{env:{ELANKAV_CONNECT_URL:'http://connect.test'},fetchImpl:async(url,init)=>{call={url,body:JSON.parse(init.body)};return {ok:true,status:201,json:async()=>({provider:{id:'p1',tradeName:'Ferromax Huembes'}})}}});
 assert.equal(call.url,'http://connect.test/api/v1/providers'); assert.equal(call.body.whatsapp,'50584937395'); assert.equal(provider.id,'p1');
});
