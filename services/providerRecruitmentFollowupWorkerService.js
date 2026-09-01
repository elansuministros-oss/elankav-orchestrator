'use strict';

const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEZONE = 'America/Managua';
const state = {
  started: false,
  enabled: false,
  running: false,
  lastRunAt: null,
  lastError: null,
  processed: 0,
  sent: 0,
  closedNoResponse: 0,
  skipped: 0
};

function clean(value){ return String(value || '').trim(); }
function enabled(env=process.env){ return String(env.PROVIDER_RECRUITMENT_FOLLOWUP_ENABLED ?? 'true').toLowerCase() !== 'false'; }
function autonomousInvestigationEnabled(env=process.env){
  return String(env.PROVIDER_AUTONOMOUS_INVESTIGATION_ENABLED || 'false').trim().toLowerCase()==='true';
}
function connectBaseUrl(env=process.env){ return clean(env.ELANKAV_CONNECT_URL || DEFAULT_CONNECT_URL).replace(/\/+$/,''); }
function token(env=process.env){
  const value=clean(env.CONNECT_PROVIDER_INTELLIGENCE_TOKEN || env.CONNECT_VOICE_TOKEN);
  if(!value) throw Object.assign(new Error('CONNECT_PROVIDER_INTELLIGENCE_TOKEN_REQUIRED'),{code:'CONNECT_PROVIDER_INTELLIGENCE_TOKEN_REQUIRED'});
  return value;
}
function headers(env=process.env,extra={}){ return {Accept:'application/json','X-Connect-Provider-Token':token(env),...extra}; }
async function readJson(response){
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=Object.assign(new Error(payload?.error?.message || `CONNECT HTTP ${response.status}`),{
      code:payload?.error?.code || 'CONNECT_PROVIDER_RECRUITMENT_FAILED',status:response.status
    });
    throw error;
  }
  return payload;
}
async function get(path,{env=process.env,fetchImpl=fetch}={}){
  return readJson(await fetchImpl(connectBaseUrl(env)+path,{headers:headers(env),signal:AbortSignal.timeout(30000)}));
}
async function post(path,body,{env=process.env,fetchImpl=fetch}={}){
  return readJson(await fetchImpl(connectBaseUrl(env)+path,{method:'POST',headers:headers(env,{'Content-Type':'application/json'}),body:JSON.stringify(body),signal:AbortSignal.timeout(30000)}));
}
async function patch(path,body,{env=process.env,fetchImpl=fetch}={}){
  return readJson(await fetchImpl(connectBaseUrl(env)+path,{method:'PATCH',headers:headers(env,{'Content-Type':'application/json'}),body:JSON.stringify(body),signal:AbortSignal.timeout(30000)}));
}

function localClock(now=new Date(),timeZone=DEFAULT_TIMEZONE){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(now);
  const read=type=>parts.find(p=>p.type===type)?.value || '';
  return {weekday:read('weekday'),hour:Number(read('hour')),minute:Number(read('minute'))};
}
function withinContactWindow(now=new Date(),env=process.env){
  const zone=clean(env.PROVIDER_RECRUITMENT_TIMEZONE || DEFAULT_TIMEZONE);
  const start=Math.max(0,Math.min(23,Number(env.PROVIDER_RECRUITMENT_CONTACT_START_HOUR || 8)));
  const end=Math.max(start+1,Math.min(24,Number(env.PROVIDER_RECRUITMENT_CONTACT_END_HOUR || 18)));
  const clock=localClock(now,zone);
  if(clock.weekday==='Sun') return false;
  return clock.hour>=start && clock.hour<end;
}
function autonomousInitialMessage(item){
  const question=clean(item?.nextQuestion);
  const intro='Hola, soy ELAN, asistente de inteligencia artificial de ELAN Suministros & Tecnología.';
  return [
    intro,
    'Estamos incorporando proveedores para nuestro ecosistema.',
    question || 'Para comenzar, ¿qué productos o servicios ofrecen actualmente?'
  ].join('\n\n');
}
function isAutonomousInitialPending(item,env=process.env){
  return autonomousInvestigationEnabled(env) &&
    item?.recruitment?.recruitmentStatus==='CONTACT_PENDING' &&
    !item?.recruitment?.lastContactAt &&
    item?.recruitment?.source?.autonomousInvestigation===true;
}
function followupMessage(item){
  const name=clean(item?.provider?.tradeName);
  const attempt=Number(item?.recruitment?.followupAttempts || 0)+1;
  const question=clean(item?.nextQuestion);
  const intro='Hola, soy ELAN, asistente de inteligencia artificial de ELAN Suministros & Tecnología.';
  if(attempt>=2){
    return [
      intro,
      'Doy un último seguimiento a la información de proveedor que solicitamos anteriormente.',
      question || 'Si tienen catálogo, tarifario o condiciones comerciales vigentes, pueden enviármelos por este WhatsApp.',
      'Gracias.'
    ].join('\n\n');
  }
  return [
    intro,
    'Doy seguimiento a nuestra solicitud de información como proveedor.',
    question || '¿Podrían compartir la información comercial pendiente cuando les sea posible?'
  ].join('\n\n');
}

async function stopFollowup(providerId,{env=process.env,fetchImpl=fetch}={}){
  return patch('/api/v1/providers/'+encodeURIComponent(providerId)+'/recruitment',{nextFollowupAt:null},{env,fetchImpl});
}

async function processDueItem(item,{
  env=process.env,fetchImpl=fetch,delivery=createWahaDeliveryAdapter()
}={}){
  const id=item?.provider?.id || item?.recruitment?.providerId;
  if(!id) return {action:'SKIPPED',reason:'PROVIDER_ID_MISSING'};

  if(isAutonomousInitialPending(item,env)){
    let pre;
    try {
      pre=await get('/api/v1/providers/'+encodeURIComponent(id)+'/recruitment/contact-preflight?mode=autonomous',{env,fetchImpl});
    } catch(error){
      if(['PROVIDER_CONTACT_BLOCKED','PROVIDER_CONTACT_NOT_VERIFIED','PROVIDER_CONTACT_MISSING','PROVIDER_AUTONOMOUS_ALREADY_CONTACTED'].includes(error?.code)){
        await stopFollowup(id,{env,fetchImpl}).catch(()=>null);
        return {action:'SKIPPED',providerId:id,reason:error.code};
      }
      throw error;
    }
    const message=autonomousInitialMessage(item);
    const sent=await delivery.sendText({phone:pre.contact,text:message});
    await post('/api/v1/providers/'+encodeURIComponent(id)+'/recruitment/contact-attempts',{
      message,...(sent?.messageId?{externalMessageId:sent.messageId}:{})
    },{env,fetchImpl});
    return {action:'INITIAL_SENT',providerId:id,messageId:sent?.messageId||null};
  }

  const attempts=Number(item?.recruitment?.followupAttempts || 0);
  if(attempts>=2){
    await post('/api/v1/providers/'+encodeURIComponent(id)+'/recruitment/followups',{sent:false},{env,fetchImpl});
    return {action:'NO_RESPONSE',providerId:id};
  }
  let pre;
  try {
    pre=await get('/api/v1/providers/'+encodeURIComponent(id)+'/recruitment/contact-preflight',{env,fetchImpl});
  } catch(error){
    if(['PROVIDER_CONTACT_BLOCKED','PROVIDER_CONTACT_NOT_VERIFIED','PROVIDER_CONTACT_MISSING'].includes(error?.code)){
      await stopFollowup(id,{env,fetchImpl}).catch(()=>null);
      return {action:'SKIPPED',providerId:id,reason:error.code};
    }
    throw error;
  }
  const message=followupMessage(item);
  const sent=await delivery.sendText({phone:pre.contact,text:message});
  await post('/api/v1/providers/'+encodeURIComponent(id)+'/recruitment/followups',{
    sent:true,message,...(sent?.messageId?{externalMessageId:sent.messageId}:{})
  },{env,fetchImpl});
  return {action:'SENT',providerId:id,messageId:sent?.messageId||null};
}

async function runProviderRecruitmentFollowups({
  env=process.env,fetchImpl=fetch,delivery=createWahaDeliveryAdapter(),now=()=>new Date()
}={}){
  state.enabled=enabled(env);
  state.lastRunAt=now().toISOString();
  if(!state.enabled) return {...state,status:'DISABLED'};
  if(!withinContactWindow(now(),env)) return {...state,status:'OUTSIDE_CONTACT_WINDOW'};
  if(state.running) return {...state,status:'ALREADY_RUNNING'};
  state.running=true;
  try{
    const limit=Math.max(1,Math.min(20,Number(env.PROVIDER_RECRUITMENT_FOLLOWUP_BATCH || 10)));
    const due=await get('/api/v1/providers/recruitment/followups/due?limit='+limit,{env,fetchImpl});
    const rows=Array.isArray(due?.rows)?due.rows:[];
    for(const item of rows){
      const result=await processDueItem(item,{env,fetchImpl,delivery});
      state.processed+=1;
      if(result.action==='SENT'||result.action==='INITIAL_SENT') state.sent+=1;
      else if(result.action==='NO_RESPONSE') state.closedNoResponse+=1;
      else state.skipped+=1;
    }
    state.lastError=null;
    return {...state,status:'OK',batch:rows.length};
  }catch(error){
    state.lastError={code:error?.code||null,message:error?.message||String(error)};
    console.error('[PROVIDER_RECRUITMENT_FOLLOWUP_FAILED]',state.lastError);
    return {...state,status:'ERROR'};
  }finally{
    state.running=false;
  }
}

function startProviderRecruitmentFollowupWorker({env=process.env,...deps}={}){
  if(state.started) return {started:false,...state};
  state.started=true;
  state.enabled=enabled(env);
  if(!state.enabled){
    console.log('[PROVIDER_RECRUITMENT_FOLLOWUP_WORKER]',{enabled:false});
    return {started:true,...state};
  }
  const intervalMs=Math.max(60_000,Number(env.PROVIDER_RECRUITMENT_FOLLOWUP_INTERVAL_MS || DEFAULT_INTERVAL_MS));
  const tick=()=>runProviderRecruitmentFollowups({env,...deps}).catch(error=>{
    console.error('[PROVIDER_RECRUITMENT_FOLLOWUP_TICK_FAILED]',{code:error?.code||null,message:error?.message||String(error)});
  });
  const timer=setInterval(tick,intervalMs);
  timer.unref?.();
  setTimeout(tick,5000).unref?.();
  console.log('[PROVIDER_RECRUITMENT_FOLLOWUP_WORKER]',{enabled:true,intervalMs,maxAutomaticFollowups:2,timeZone:env.PROVIDER_RECRUITMENT_TIMEZONE||DEFAULT_TIMEZONE});
  return {started:true,...state,timer};
}

function getProviderRecruitmentFollowupState(){ return {...state}; }

module.exports={
  autonomousInitialMessage,autonomousInvestigationEnabled,followupMessage,getProviderRecruitmentFollowupState,isAutonomousInitialPending,localClock,processDueItem,
  runProviderRecruitmentFollowups,startProviderRecruitmentFollowupWorker,withinContactWindow
};
