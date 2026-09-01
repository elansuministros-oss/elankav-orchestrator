'use strict';

function clean(value){return String(value||'').trim();}
function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}

function firstObject(...values){
  return values.find(isObject)||{};
}

function extractWhatsappAttribution(payload={},body={}){
  const referral=firstObject(
    payload.referral,
    payload.message?.referral,
    payload.context?.referral,
    payload._data?.referral,
    payload._data?.context?.referral,
    body.referral
  );
  const ads=firstObject(
    payload.adsContextData,
    payload.adContext,
    payload._data?.adsContextData,
    payload._data?.adContext
  );

  const sourceUrl=clean(
    referral.source_url||referral.sourceUrl||
    ads.source_url||ads.sourceUrl||
    payload.source_url||payload.sourceUrl
  );
  const sourceType=clean(
    referral.source_type||referral.sourceType||
    ads.source_type||ads.sourceType
  );
  const sourceId=clean(
    referral.source_id||referral.sourceId||
    ads.source_id||ads.sourceId
  );
  const ctwaClid=clean(
    referral.ctwa_clid||referral.ctwaClid||
    ads.ctwa_clid||ads.ctwaClid||
    payload.ctwa_clid||payload.ctwaClid
  );
  const campaignId=clean(
    referral.campaign_id||referral.campaignId||
    ads.campaign_id||ads.campaignId||
    payload.campaign_id||payload.campaignId
  );
  const campaignName=clean(
    referral.campaign_name||referral.campaignName||
    ads.campaign_name||ads.campaignName||
    payload.campaign_name||payload.campaignName
  );
  const adsetId=clean(
    referral.adset_id||referral.adsetId||
    ads.adset_id||ads.adsetId||
    payload.adset_id||payload.adsetId
  );
  const adId=clean(
    referral.ad_id||referral.adId||
    ads.ad_id||ads.adId||
    payload.ad_id||payload.adId||
    sourceId
  );
  const headline=clean(referral.headline||ads.headline);
  const bodyText=clean(referral.body||ads.body);
  const sourceLower=(sourceUrl+' '+sourceType+' '+clean(referral.source)).toLowerCase();
  const hasCampaignEvidence=Boolean(
    sourceUrl||sourceType||sourceId||ctwaClid||campaignId||campaignName||adsetId||adId
  );

  let originPlatform='';
  if(/instagram/.test(sourceLower))originPlatform='instagram';
  else if(/facebook|fb\.com|messenger/.test(sourceLower))originPlatform='facebook';
  else if(hasCampaignEvidence)originPlatform='meta';

  if(!hasCampaignEvidence)return null;

  return {
    source:'meta_referral',
    originPlatform,
    sourceType:sourceType||'referral',
    sourceUrl:sourceUrl||null,
    sourceId:sourceId||null,
    ctwaClid:ctwaClid||null,
    campaignId:campaignId||null,
    campaignName:campaignName||null,
    adsetId:adsetId||null,
    adId:adId||null,
    headline:headline||null,
    body:bodyText||null
  };
}

module.exports={extractWhatsappAttribution};
