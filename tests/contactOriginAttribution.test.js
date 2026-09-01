'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

const { extractWhatsappAttribution }=require('../services/whatsappAttributionMetadata');
const { extractIncoming }=require('../api/wahaWebhookApi');
const { requestConversationDecision }=require('../services/connectConversationClient');

test('extrae Click-to-WhatsApp referral de Facebook',()=>{
  const payload={
    from:'50588880000@c.us',
    id:{id:'msg-1',fromMe:false},
    body:'Hola',
    referral:{
      source_url:'https://www.facebook.com/ads/example',
      source_type:'ad',
      source_id:'ad-123',
      ctwa_clid:'ctwa-999',
      headline:'Rótulos iluminados'
    }
  };
  const attribution=extractWhatsappAttribution(payload,{});
  assert.ok(attribution);
  assert.equal(attribution.originPlatform,'facebook');
  assert.equal(attribution.sourceType,'ad');
  assert.equal(attribution.adId,'ad-123');
  assert.equal(attribution.ctwaClid,'ctwa-999');

  const incoming=extractIncoming({event:'message',payload});
  assert.equal(incoming.attribution.originPlatform,'facebook');
  assert.equal(incoming.attribution.adId,'ad-123');
});

test('WhatsApp orgánico sin referral no inventa campaña',()=>{
  const incoming=extractIncoming({
    event:'message',
    payload:{from:'50588887777@c.us',id:{id:'msg-2',fromMe:false},body:'Precio'}
  });
  assert.equal(incoming.attribution,null);
});

test('requestConversationDecision propaga teléfono, campaña y metadata a CONNECT',async()=>{
  let captured=null;
  const fetchImpl=async(_url,options)=>{
    captured=JSON.parse(options.body);
    return {
      ok:true,
      status:200,
      async json(){
        return {
          ok:true,
          action:'RESPOND',
          attribution:{
            originType:'FACEBOOK_CAMPAIGN',
            engagementMode:'inbound_sales'
          }
        };
      }
    };
  };

  const result=await requestConversationDecision({
    identity:'50588880000@c.us',
    platform:'ELANVISUAL',
    message:'Hola',
    phone:'50588880000',
    channel:'whatsapp',
    externalMessageId:'msg-3',
    source:'meta_referral',
    campaign:'Rótulos 2026',
    metadata:{
      attribution:{
        originPlatform:'facebook',
        campaignId:'cmp-1',
        adId:'ad-1'
      }
    }
  },{
    fetchImpl,
    env:{
      CONNECT_INTERNAL_API_TOKEN:'test-token',
      ELANKAV_CONNECT_URL:'https://connect.test'
    }
  });

  assert.equal(result.action,'RESPOND');
  assert.equal(captured.phone,'50588880000');
  assert.equal(captured.channel,'whatsapp');
  assert.equal(captured.externalMessageId,'msg-3');
  assert.equal(captured.source,'meta_referral');
  assert.equal(captured.campaign,'Rótulos 2026');
  assert.equal(captured.metadata.attribution.campaignId,'cmp-1');
});
