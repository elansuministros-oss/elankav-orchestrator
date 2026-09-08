'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContext}=require('../services/context/contextBuilder');

function owner(id, extra={}) {
  const old=process.env.ORCHESTRATOR_OWNER_PHONES;
  process.env.ORCHESTRATOR_OWNER_PHONES='50588388940';
  try { return buildContext({message:'Modo operador',platform:'elanvisual',channel:'whatsapp',externalUserId:id,...extra}); }
  finally { if(old===undefined) delete process.env.ORCHESTRATOR_OWNER_PHONES; else process.env.ORCHESTRATOR_OWNER_PHONES=old; }
}

test('PROTECTED Owner direct @c.us',()=>{
  const c=owner('50588388940@c.us'); assert.equal(c.owner.isOwner,true); assert.equal(c.externalUserId,'50588388940');
});
test('PROTECTED Owner @lid alias',()=>{
  const c=owner('215440458567779@lid'); assert.equal(c.owner.isOwner,true); assert.equal(c.phone,'50588388940');
});
test('PROTECTED receiver is not Owner',()=>assert.equal(owner('50578828089@c.us').owner.isOwner,false));
test('PROTECTED customer is not Owner',()=>assert.equal(owner('50588888888@c.us').owner.isOwner,false));
