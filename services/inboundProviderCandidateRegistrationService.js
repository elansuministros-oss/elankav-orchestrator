'use strict';

const { classifyInboundCommercialRelationship } = require('./inboundCommercialRoleService');

function clean(v){return String(v||'').trim();}
function normPhone(v){const d=clean(v).split('@')[0].replace(/\D/g,'');return d.length===8?`505${d}`:d;}
function normalized(v){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function historyText(input={}){
  const history=Array.isArray(input?.metadata?.connectDecision?.history)?input.metadata.connectDecision.history:[];
  return [...history.map(x=>clean(x?.content)),clean(input.message)].filter(Boolean).join('\n');
}
function inferKind(text){
  const n=normalized(text);
  if(/\b(andamio|andamios|alquiler|renta|servicio|servicios|instalacion|transporte)\b/.test(n)) return ['services_subcontracting'];
  if(/\b(lamina|laminas|material|materiales|producto|productos|insumo|insumos|acero|hierro|vinil|pvc|acrilico)\b/.test(n)) return ['materials_products'];
  return ['materials_products','services_subcontracting'];
}
function extractIntro(text){
  const lines=String(text||'').split(/\n+/).map(clean).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(/^(?:le\s+saluda|soy|mi\s+nombre\s+es)\s+(.+)$/i);
    if(!m) continue;
    const contact=clean(m[1]);
    const next=clean(lines[i+1]);
    const c=next.match(/^(?:de|desde)\s+(.+)$/i);
    if(c) return {contactName:contact,tradeName:clean(c[1])};
  }
  return null;
}
function candidateFromInput(input={}){
  const text=historyText(input);
  const classification=classifyInboundCommercialRelationship({message:clean(input.message),actor:null});
  const meta=input.metadata&&typeof input.metadata==='object'?input.metadata:{};
  const media=meta.media&&typeof meta.media==='object'?meta.media:{};
  const fileName=clean(media.filename||media.fileName);
  const isCommercialPdf=meta.messageType==='document' && /\.(pdf)$/i.test(fileName) && /\b(cotiz\w*|catalog\w*|tarif\w*|precio\w*|proforma\w*)\b/i.test(fileName);
  if(classification.kind!=='provider_candidate' && !isCommercialPdf) return null;
  const intro=extractIntro(text);
  const whatsappName=clean(meta.whatsappName);
  const tradeName=clean(intro?.tradeName || (isCommercialPdf?whatsappName:''));
  if(!tradeName) return null;
  const contactName=clean(intro?.contactName || (whatsappName && normalized(whatsappName)!==normalized(tradeName)?whatsappName:''));
  const phone=normPhone(input.phone || meta.phone || meta.senderRaw || meta.chatId);
  if(!phone) return null;
  return {
    tradeName,
    ...(contactName?{contactName}:{}),
    whatsapp:phone,
    phone,
    currency:'NIO',
    status:'active',
    platforms:['ELANVISUAL'],
    kinds:inferKind(text+' '+fileName),
    categories:[],
    specialties:[],
    notes:'Registro automático por evidencia comercial inbound de WhatsApp; datos no explícitos pendientes de completar.'
  };
}
function connectUrl(env=process.env){return clean(env.ELANKAV_CONNECT_URL||'http://127.0.0.1:4400').replace(/\/+$/,'');}
async function upsertInboundProviderCandidate(input={},options={}){
  const candidate=candidateFromInput(input);
  if(!candidate) return null;
  const fetchImpl=options.fetchImpl||fetch;
  const response=await fetchImpl(connectUrl(options.env||process.env)+'/api/v1/providers',{
    method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(candidate),signal:AbortSignal.timeout(15000)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(payload?.error?.message||`CONNECT provider HTTP ${response.status}`);e.code=payload?.error?.code||'INBOUND_PROVIDER_UPSERT_FAILED';e.status=response.status;throw e;}
  return payload?.provider||payload?.data||payload||null;
}
module.exports={candidateFromInput,extractIntro,inferKind,upsertInboundProviderCandidate};
