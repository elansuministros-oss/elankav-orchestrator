'use strict';

const messageService = require('./messageService');
const { createWahaDeliveryAdapter, normalizePhone } = require('../adapters/wahaDeliveryAdapter');
const { downloadProviderMedia } = require('./providerInboundIntelligenceService');
const { rawOwnerIdentity } = require('./ownerProviderCandidateOutreachMessagePatch');

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
let installed = false;
const PENDING_MEDIA_TTL_MS = 5 * 60 * 1000;
const pendingOwnerMedia = new Map();

function clean(value) { return String(value || '').trim(); }
function normalized(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g,' ');
}
function connectUrl() { return clean(process.env.ELANKAV_CONNECT_URL || DEFAULT_CONNECT_URL).replace(/\/+$/,''); }
function recruitmentToken() {
  const token=clean(process.env.CONNECT_PROVIDER_INTELLIGENCE_TOKEN || process.env.CONNECT_VOICE_TOKEN);
  if(!token) {
    const error=new Error('CONNECT_PROVIDER_INTELLIGENCE_TOKEN_REQUIRED');
    error.code='CONNECT_PROVIDER_INTELLIGENCE_TOKEN_REQUIRED'; error.status=503; throw error;
  }
  return token;
}
function headers(extra={}) { return {Accept:'application/json','X-Connect-Provider-Token':recruitmentToken(),...extra}; }
async function json(response) {
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) {
    const error=new Error(payload?.error?.message || `CONNECT HTTP ${response.status}`);
    error.code=payload?.error?.code || 'CONNECT_PROVIDER_RECRUITMENT_FAILED'; error.status=response.status; throw error;
  }
  return payload;
}
async function get(path, fetchImpl=fetch) {
  return json(await fetchImpl(connectUrl()+path,{headers:headers(),signal:AbortSignal.timeout(30000)}));
}
async function post(path, body, fetchImpl=fetch) {
  return json(await fetchImpl(connectUrl()+path,{method:'POST',headers:headers({'Content-Type':'application/json'}),body:JSON.stringify(body),signal:AbortSignal.timeout(120000)}));
}
async function patch(path, body, fetchImpl=fetch) {
  return json(await fetchImpl(connectUrl()+path,{method:'PATCH',headers:headers({'Content-Type':'application/json'}),body:JSON.stringify(body),signal:AbortSignal.timeout(30000)}));
}
async function postBytes(path, bytes, {mimeType,fileName,messageId,contextText,documentType,ownerPhone,source}={}, fetchImpl=fetch) {
  const h=headers({
    'Content-Type':mimeType || 'application/octet-stream',
    'X-File-Name':encodeURIComponent(fileName || 'provider-evidence'),
    ...(messageId?{'X-External-Message-Id':encodeURIComponent(messageId)}:{}),
    ...(contextText?{'X-Context-Text':encodeURIComponent(contextText)}:{}),
    ...(documentType?{'X-Document-Type':encodeURIComponent(documentType)}:{}),
    ...(ownerPhone?{'X-Owner-Phone':encodeURIComponent(ownerPhone)}:{}),
    ...(source?{'X-Source-Json':encodeURIComponent(JSON.stringify(source))}:{})
  });
  return json(await fetchImpl(connectUrl()+path,{method:'POST',headers:h,body:bytes,signal:AbortSignal.timeout(150000)}));
}

function extractPhone(message) {
  const match=clean(message).match(/(?:\+?505[\s().-]*)?\d{4}[\s.-]*\d{4}/);
  return match ? normalizePhone(match[0]) : '';
}
function pendingKey(args={}) { return normalizePhone(args.phone || args.externalUserId || args.metadata?.senderRaw || '') || 'owner'; }
function rememberPendingMedia(args,kind) {
  pendingOwnerMedia.set(pendingKey(args),{kind,originalMessage:clean(args.message),expiresAt:Date.now()+PENDING_MEDIA_TTL_MS});
}
function consumePendingMedia(args) {
  const key=pendingKey(args),item=pendingOwnerMedia.get(key);
  if(!item) return null;
  if(item.expiresAt<=Date.now()){pendingOwnerMedia.delete(key);return null;}
  if(!args.metadata?.media?.url) return null;
  pendingOwnerMedia.delete(key);
  return item;
}
function clearPendingOwnerMedia(){ pendingOwnerMedia.clear(); }

function commandKind(message, metadata={}) {
  const n=normalized(message), hasMedia=Boolean(metadata?.media?.url);
  if(!n) return null;
  if(/\bproveedores?\s+sin\s+(?:tarifario|lista de precios)\b/.test(n)) return 'missing_price_list';
  if(/\bproveedores?\s+pendientes\b/.test(n)) return 'pending';
  if(/\b(?:muestrame|mostrame|dime|que)\b.*\brespondio\b.*\bproveedor\b/.test(n)) return 'show_response';
  if(/\bestado\b.*\bproveedor\b/.test(n)) return 'status';
  if(/\b(?:agrega|anade|añade|guarda|adjunta)\b.*\bcatalogo\b.*\bproveedor\b/.test(n)) return 'add_catalog';
  if(/\b(?:solicita|pide|pedile|pidele)\b.*\b(?:tarifario|lista de precios|precios)\b.*\bproveedor\b/.test(n)) return 'request_price_list';
  if(/\b(?:recluta|reclutar|incorpora|incorporar)\b.*\bproveedor\b/.test(n)) return 'recruit';
  if(/\b(?:contacta|contactale|escribe|escribile|escribele)\b.*\bproveedor\b/.test(n)) return 'contact';
  if(/\b(?:registra|registrar|agrega|alta)\b.*\bproveedor\b/.test(n)) return 'register';
  if(/\b(?:investiga|investigar|analiza|revisa)\b.*\bproveedor\b/.test(n)) return 'investigate';
  if(hasMedia && /\bproveedor\b/.test(n)) return 'investigate';
  return null;
}
function extractProviderQuery(message) {
  let text=clean(message)
    .replace(/(?:\+?505[\s().-]*)?\d{4}[\s.-]*\d{4}/g,' ')
    .replace(/\belan\b/ig,' ')
    .replace(/\b(?:recluta|reclutar|incorpora|incorporar|registra|registrar|investiga|investigar|analiza|revisa|contacta|contactale|escribe|escribile|escribele|solicita|pide|pedile|pidele|estado|proveedor|proveedores|tarifario|lista de precios|precios|muestrame|mostrame|que|respondio|agrega|catalogo|este|esta|al|a|el|la|de|del|por favor)\b/ig,' ')
    .replace(/\s+/g,' ').trim();
  return text.length>=2 ? text : '';
}
async function providerRows(search, fetchImpl=fetch) {
  const suffix=search ? '?search='+encodeURIComponent(search)+'&status=active' : '?status=active';
  const response=await fetchImpl(connectUrl()+'/api/v1/providers'+suffix,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok) return [];
  const rows=await response.json().catch(()=>[]);
  return Array.isArray(rows)?rows:[];
}
async function resolveTarget(message,{allowLatest=true,fetchImpl=fetch}={}) {
  const phone=extractPhone(message);
  if(phone) {
    const rows=await providerRows(phone,fetchImpl);
    const exact=rows.find(row=>[row.whatsapp,row.phone].map(normalizePhone).includes(phone));
    if(exact) return {provider:exact};
  }
  const q=extractProviderQuery(message);
  if(q) {
    const rows=await providerRows(q,fetchImpl);
    if(rows.length===1) return {provider:rows[0]};
    if(rows.length>1) {
      const error=new Error('PROVIDER_TARGET_AMBIGUOUS'); error.code='PROVIDER_TARGET_AMBIGUOUS'; error.status=409; error.matches=rows.slice(0,8); throw error;
    }
  }
  if(allowLatest) {
    try {
      const latest=await get('/api/v1/providers/recruitment/latest',fetchImpl);
      return {provider:latest.provider,recruitment:latest.recruitment};
    } catch {}
  }
  return null;
}
async function intakeFromOwner(args,{fetchImpl=fetch}={}) {
  const source={channel:'whatsapp_owner',ownerPhone:args.phone||null,externalMessageId:args.metadata?.messageId||null,receivedAt:new Date().toISOString()};
  if(args.metadata?.media?.url && ['image','document'].includes(clean(args.metadata?.messageType).toLowerCase())) {
    const media=await downloadProviderMedia({url:args.metadata.media.url,fetchImpl});
    return postBytes('/api/v1/providers/recruitment/intake-document',media.buffer,{
      mimeType:media.mimeType || args.metadata.media.mimeType,
      fileName:args.metadata.media.filename || 'provider-evidence',
      messageId:args.metadata?.messageId,
      contextText:args.message,
      ownerPhone:args.phone,
      source
    },fetchImpl);
  }
  return post('/api/v1/providers/recruitment/intake',{
    text:args.message,source,...(args.metadata?.messageId?{externalMessageId:args.metadata.messageId}:{})
  },fetchImpl);
}
function initialMessage(mode, nextQuestion) {
  const intro='Hola, soy ELAN, asistente de inteligencia artificial de ELAN Suministros & Tecnología.';
  if(mode==='request_price_list') {
    return [intro,'Estamos actualizando nuestro registro de proveedores. ¿Podrían compartir por este WhatsApp su catálogo y/o tarifario vigente?'].join('\n\n');
  }
  if(mode==='recruit') {
    return [intro,'Estamos incorporando proveedores para nuestro ecosistema. ¿Podrían compartir su catálogo o tarifario vigente? Si no manejan catálogo, indíquenme qué productos o servicios ofrecen actualmente.'].join('\n\n');
  }
  return [intro,'Estamos incorporando proveedores para nuestro ecosistema.',nextQuestion || 'Para comenzar, ¿qué productos o servicios ofrecen actualmente?'].join('\n\n');
}
function providerLabel(result) {
  return result?.provider?.tradeName || result?.provider?.businessName || 'Proveedor';
}
async function contactProvider(providerId,mode,{delivery=createWahaDeliveryAdapter(),fetchImpl=fetch}={}) {
  const pre=await get('/api/v1/providers/'+encodeURIComponent(providerId)+'/recruitment/contact-preflight',fetchImpl);
  const message=initialMessage(mode,pre.nextQuestion);
  const sent=await delivery.sendText({phone:pre.contact,text:message});
  await post('/api/v1/providers/'+encodeURIComponent(providerId)+'/recruitment/contact-attempts',{
    message,...(sent?.messageId?{externalMessageId:sent.messageId}:{})
  },fetchImpl);
  return {pre,message,sent};
}
function summarize(result,prefix='Proveedor procesado') {
  const r=result?.recruitment || {};
  return [
    '✅ '+prefix+'.',
    'Proveedor: '+providerLabel(result),
    'Estado: '+(r.recruitmentStatus || 'DISCOVERED'),
    'Contacto verificado: '+(r.contactVerified?'sí':'no'),
    result?.created===true?'Registro: nuevo':'Registro: existente/actualizado',
    result?.matchedBy?'Coincidencia: '+result.matchedBy:'',
    result?.nextQuestion?'Siguiente dato pendiente: '+result.nextQuestion:''
  ].filter(Boolean).join('\n');
}
function ownerResult(reply, command) {
  return {
    message:command?.raw||'',reply,provider:'elankav',model:'elan-provider-recruitment',
    responseId:null,status:'completed',usage:null,suppressDelivery:false,ownerCrmCommand:true,
    actorRole:'owner',actorId:'owner',accessScopes:['*'],command
  };
}
async function runCommand(kind,args,deps={}) {
  const fetchImpl=deps.fetchImpl||fetch;
  if(kind==='register'||kind==='investigate'||kind==='recruit') {
    const result=await intakeFromOwner(args,{fetchImpl});
    if(kind!=='recruit') {
      return ownerResult(summarize(result,kind==='register'?'Proveedor registrado para reclutamiento':'Proveedor analizado'),{type:kind,providerId:result.provider?.id,raw:args.message});
    }
    const providerId=result?.provider?.id;
    if(!providerId) throw Object.assign(new Error('No pude crear o identificar el proveedor desde la evidencia.'),{code:'PROVIDER_TARGET_NOT_FOUND',status:404});
    try {
      const sent=await contactProvider(providerId,'recruit',{delivery:deps.delivery||createWahaDeliveryAdapter(),fetchImpl});
      return ownerResult([
        summarize(result,'Proveedor reclutado'),
        '',
        '✅ Primer contacto enviado automáticamente.',
        'WhatsApp: +'+normalizePhone(sent.pre.contact),
        'ELAN se identificó explícitamente como inteligencia artificial.',
        'Estado: CONTACTED'
      ].join('\n'),{type:kind,providerId,messageId:sent.sent?.messageId||null,raw:args.message});
    } catch(error) {
      if(['PROVIDER_CONTACT_NOT_VERIFIED','PROVIDER_CONTACT_MISSING','PROVIDER_CONTACT_BLOCKED'].includes(error?.code)) {
        return ownerResult([
          summarize(result,'Proveedor registrado para reclutamiento'),
          '',
          '⚠️ No envié ningún mensaje todavía.',
          error.code==='PROVIDER_CONTACT_NOT_VERIFIED'
            ? 'Motivo: el número encontrado aún no está suficientemente vinculado al proveedor.'
            : error.code==='PROVIDER_CONTACT_MISSING'
              ? 'Motivo: no encontré un WhatsApp o teléfono utilizable.'
              : 'Motivo: el proveedor está bloqueado para contacto.',
          'ELAN no contactará un número dudoso o bloqueado.'
        ].join('\n'),{type:kind,providerId,errorCode:error.code,raw:args.message});
      }
      throw error;
    }
  }
  if(kind==='pending'||kind==='missing_price_list') {
    const path=kind==='missing_price_list'?'/api/v1/providers/recruitment?missing=price_list&limit=50':'/api/v1/providers/recruitment?limit=50';
    const result=await get(path,fetchImpl), rows=Array.isArray(result.rows)?result.rows:[];
    const filtered=kind==='pending'?rows.filter(x=>!['REGISTERED','REJECTED'].includes(x.recruitment?.recruitmentStatus)):rows;
    const lines=filtered.slice(0,20).map((x,i)=>`${i+1}. ${providerLabel(x)} — ${x.recruitment?.recruitmentStatus||'DISCOVERED'}`);
    return ownerResult(lines.length?lines.join('\n'):'No hay proveedores que coincidan con esa consulta.',{type:kind,raw:args.message});
  }
  const target=await resolveTarget(args.message,{allowLatest:true,fetchImpl});
  if(!target?.provider?.id) throw Object.assign(new Error('No pude identificar el proveedor.'),{code:'PROVIDER_TARGET_NOT_FOUND',status:404});
  const id=target.provider.id;
  if(kind==='status') {
    const result=await get('/api/v1/providers/'+encodeURIComponent(id)+'/recruitment',fetchImpl);
    const r=result.recruitment;
    return ownerResult([
      'Proveedor: '+providerLabel(result),'Estado: '+r.recruitmentStatus,'Calificación: '+r.qualificationStatus,
      'Contacto verificado: '+(r.contactVerified?'sí':'no'),'Catálogos: '+r.catalogs.length,'Tarifarios: '+r.priceLists.length,
      'Último contacto: '+(r.lastContactAt||'ninguno'),'Última respuesta: '+(r.lastResponseAt||'ninguna'),
      result.nextQuestion?'Pendiente: '+result.nextQuestion:''
    ].filter(Boolean).join('\n'),{type:kind,providerId:id,raw:args.message});
  }
  if(kind==='show_response') {
    const history=await get('/api/v1/providers/'+encodeURIComponent(id)+'/recruitment/history?limit=5',fetchImpl);
    const rows=Array.isArray(history.rows)?history.rows:[];
    const lines=rows.map(row=>clean(row.snapshot?.text)).filter(Boolean);
    return ownerResult(lines.length?['Últimas respuestas de '+target.provider.tradeName+':',...lines.map((x,i)=>`${i+1}. ${x}`)].join('\n'):'No hay respuestas registradas todavía.',{type:kind,providerId:id,raw:args.message});
  }
  if(kind==='add_catalog') {
    if(!args.metadata?.media?.url) throw Object.assign(new Error('Adjuntá el catálogo o archivo que querés agregar.'),{code:'PROVIDER_CATALOG_MEDIA_REQUIRED',status:400});
    const media=await downloadProviderMedia({url:args.metadata.media.url,fetchImpl});
    const fileName=args.metadata.media.filename||'catalogo';
    const analysis=await postBytes('/api/v1/providers/'+encodeURIComponent(id)+'/intelligence/documents',media.buffer,{
      mimeType:media.mimeType||args.metadata.media.mimeType,fileName,
      messageId:args.metadata?.messageId
    },fetchImpl);
    const result=await postBytes('/api/v1/providers/'+encodeURIComponent(id)+'/recruitment/documents',media.buffer,{
      mimeType:media.mimeType||args.metadata.media.mimeType,fileName,
      messageId:args.metadata?.messageId,documentType:analysis?.documentType||'catalog'
    },fetchImpl);
    return ownerResult([
      summarize(result,'Catálogo agregado'),
      'Datos comerciales nuevos: '+Number(analysis?.observationsSaved||0),
      'Duplicados omitidos: '+Number(analysis?.duplicatesSkipped||0)
    ].join('\n'),{type:kind,providerId:id,raw:args.message});
  }
  if(kind==='contact'||kind==='request_price_list') {
    let result;
    const phone=extractPhone(args.message);
    if(phone) {
      result=await intakeFromOwner(args,{fetchImpl});
    } else {
      try { result=await get('/api/v1/providers/'+encodeURIComponent(id)+'/recruitment',fetchImpl); }
      catch { result=null; }
    }
    const providerId=result?.provider?.id || id;
    const sent=await contactProvider(providerId,kind,{delivery:deps.delivery||createWahaDeliveryAdapter(),fetchImpl});
    return ownerResult([
      '✅ Mensaje enviado.',
      'Proveedor: '+(result?providerLabel(result):target.provider.tradeName),
      'WhatsApp: +'+normalizePhone(sent.pre.contact),
      'ELAN se identificó explícitamente como inteligencia artificial.',
      'Estado: CONTACTED'
    ].join('\n'),{type:kind,providerId,messageId:sent.sent?.messageId||null,raw:args.message});
  }
  return null;
}

function installOwnerProviderRecruitmentMessagePatch() {
  if(installed) return false;
  const previous=messageService.processMessage;
  if(typeof previous!=='function') throw Object.assign(new Error('MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'),{code:'MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'});
  messageService.processMessage=async function processMessageWithProviderRecruitment(args={}){
    if(!rawOwnerIdentity(args)) return previous(args);
    const pending=consumePendingMedia(args);
    const detected=commandKind(args.message,args.metadata);
    const kind=pending?.kind || detected;
    if(!kind) return previous(args);
    if((kind==='register'||kind==='investigate'||kind==='recruit') && !args.metadata?.media?.url) {
      const phone=extractPhone(args.message);
      const query=extractProviderQuery(args.message);
      if(!phone && !query) {
        rememberPendingMedia(args,kind);
        return ownerResult(kind==='recruit'
          ? 'Listo. Enviame ahora la captura, imagen, PDF, catálogo o archivo del posible proveedor. Lo registraré y, si el contacto queda verificado, ELAN le escribirá automáticamente.'
          : 'Listo. Enviame ahora la captura, imagen, PDF, catálogo o archivo del proveedor y lo asociaré a este reclutamiento.',{type:kind,pendingMedia:true,raw:args.message});
      }
    }
    if(pending) {
      args={...args,message:[pending.originalMessage,clean(args.message)].filter(Boolean).join('\n')};
    }
    try {
      return await runCommand(kind,args);
    } catch(error) {
      if(error?.code==='PROVIDER_TARGET_AMBIGUOUS') {
        const matches=Array.isArray(error.matches)?error.matches:[];
        return ownerResult(['Encontré varios proveedores. Indicame cuál:',...matches.map((x,i)=>`${i+1}. ${x.tradeName}`)].join('\n'),{type:kind,raw:args.message});
      }
      const detail=error?.message||String(error);
      return ownerResult('No ejecuté el contacto/registro: '+detail,{type:kind,errorCode:error?.code||null,raw:args.message});
    }
  };
  installed=true;
  console.log('[OWNER_PROVIDER_RECRUITMENT_PATCH_INSTALLED]',{
    connectCanonicalProvider:true,dedupe:true,evidence:true,contactPreflight:true,aiDisclosure:true,massMessaging:false
  });
  return true;
}

module.exports={
  commandKind,contactProvider,extractProviderQuery,initialMessage,installOwnerProviderRecruitmentMessagePatch,
  intakeFromOwner,resolveTarget,runCommand,rememberPendingMedia,consumePendingMedia,clearPendingOwnerMedia
};
