'use strict';

const { buildContext } = require('./context/contextBuilder');
const { downloadWahaMedia } = require('./connectVoiceService');
const {
  executeThroughConnect,
  formatAuthorizedPriceResult,
  loadConversationMemory,
  persistUnifiedContext,
  persistUnifiedWorkingState
} = require('./elanUnifiedRuntimeService');
const {
  installOwnerBusinessProcessMessageGateway,
  executeOwnerBusinessCommand: executeOwnerBusinessGatewayCommand
} = require('./ownerBusinessProcessMessageGateway');
const { resolveCommercialActorSafely } = require('./connectActorIdentityService');
const {
  resolveOwnerSemanticIntent,
  semanticIntentToBusinessCommand,
  shouldResolveOwnerSemanticIntent
} = require('./ownerSemanticIntentService');
const { detectOwnerUnifiedCommand, executeOwnerUnifiedCommand } = require('./elanUnifiedOwnerCommandService');
const {
  handleOwnerEntityCreateContinuity,
  clearPendingEntityCreate
} = require('./ownerEntityCreateContinuityService');

const INSTALL_MARK = Symbol.for('elankav.elanUnifiedRuntimeMessagePatch.installed');

function normalized(value){return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ')}
function detectAuthorizedPriceLookup(message){
  const text=String(message||'').trim();if(!text)return null;const lower=text.toLowerCase();
  if(/\b(agrega|agregar|publica|publicar|aprueba|aprobar|actualiza|actualizar|cambia|cambiar|elimina|eliminar)\b/i.test(lower))return null;
  if(!/(cu[aá]l\s+es\s+el\s+precio|cu[aá]nto\s+cuesta|cu[aá]nto\s+vale|precio\s+(?:autorizado\s+)?de|costo\s+de)/i.test(text))return null;
  const query=text.replace(/^\s*elan\s*[,;:\-]?\s*/i,'').replace(/^.*?(?:cu[aá]l\s+es\s+el\s+precio\s+(?:autorizado\s+)?de|cu[aá]nto\s+cuesta|cu[aá]nto\s+vale|precio\s+(?:autorizado\s+)?de|costo\s+de)\s*/i,'').replace(/[?.!]+$/g,'').trim();
  return query?{tool:'buscar_precio_autorizado',arguments:{query}}:null;
}
function detectPriceMeasureFollowUp(message){const text=String(message||'').trim();return Boolean(text&&/(medida|medidas|tama[nñ]o|tama[nñ]os|est[aá]ndar|varias\s+medidas|qu[eé]\s+medidas|esas\s+medidas)/i.test(text))}
function detectQuotationImageIntent(message,metadata={}){
  if(String(metadata?.messageType||'').toLowerCase()!=='image'||!metadata?.media?.url)return null;
  const text=String(message||'').trim();
  if(!/(agrega|agregar|carga|cargar|sube|subir|pon|poner|adjunta|adjuntar|usa|usar).*(imagen|foto|archivo)|(?:imagen|foto).*(cotizaci[oó]n)/i.test(text))return null;
  const match=text.match(/cotizaci[oó]n(?:\s+(?:de|para|del|a))?\s+(.+?)(?:[.,;]|$)/i);
  const query=String(match?.[1]||'').replace(/\b(?:agrega|carga|sube|pon|adjunta|esta|esa|imagen|foto)\b.*$/i,'').trim();
  return{query,media:metadata.media,itemId:String(metadata?.quotationItemId||'').trim()||null};
}
function detectDesignSendFollowUp(message){
  const text=String(message||'').trim();
  const match=text.match(/^(?:elan[\s,:-]+)?(?:mand[aá]sela|mandasela|env[ií]asela|enviasela|mandala|m[aá]ndala|enviala|env[ií]ala)(?:\s+la\s+propuesta|\s+el\s+dise[nñ]o)?\s+(?:a\s+)?(.+?)[.!]?$/i);
  if(!match?.[1])return null;
  return{query:match[1].trim()};
}
function ownerActor(context,args){return{role:'owner',actorId:'owner',authority:'owner_identity',phone:context?.phone||args?.phone||null,scopes:['*'],platforms:['*']}}
function platformOf(context,args){return String(context?.platform||args?.platform||'ELANVISUAL').toUpperCase()}
function channelOf(context,args){return String(context?.channel||args?.channel||'whatsapp').toLowerCase()}
async function resolveRuntimeActor(context,args){
  if(context?.owner?.isOwner)return ownerActor(context,args);
  try{
    const actor=await resolveCommercialActorSafely({
      phone:context?.phone||args?.phone||null,
      identity:context?.identity?.receivedId||args?.externalUserId||null,
      externalUserId:context?.externalUserId||args?.externalUserId||null,
      chatId:context?.metadata?.chatId||args?.metadata?.chatId||null,
      metadata:context?.metadata||args?.metadata||{},
      platform:platformOf(context,args)
    });
    if(actor&&typeof actor==='object')return{
      role:actor.role||'prospect',
      actorId:actor.actorId||actor.sellerId||actor.customerId||actor.providerId||actor.prospectId||context?.externalUserId||args?.externalUserId||null,
      sellerId:actor.sellerId||null,
      sellerName:actor.displayName||null,
      registered:actor.registered===true,
      platformAllowed:actor.platformAllowed!==false,
      scopes:Array.isArray(actor.scopes)?actor.scopes:[],
      authority:actor.authority||null,
      phone:actor.canonicalPhone||context?.phone||args?.phone||null
    };
  }catch(error){
    console.error('[ELAN_UNIFIED_ACTOR_RESOLVE_FAILED]',{code:error?.code||null,message:error?.message||String(error)});
  }
  return{
    role:'prospect',
    actorId:context?.externalUserId||args?.externalUserId||context?.phone||args?.phone||null,
    registered:false,
    platformAllowed:true,
    scopes:[],
    phone:context?.phone||args?.phone||null
  };
}
async function persistRuntimeTurn({actor,context,args,direction,text,externalMessageId}){
  const rawId=String(externalMessageId||'').trim();
  const namespacedId=rawId?'unified:'+rawId:null;
  return persistUnifiedContext({
    actor,
    platform:platformOf(context,args),
    channel:channelOf(context,args),
    direction,
    text,
    messageType:args?.metadata?.messageType==='audio'?'audio':'text',
    externalMessageId:namespacedId,
    safe:true
  });
}
async function persistOwnerTurn({context,args,direction,text,externalMessageId}){return persistRuntimeTurn({actor:ownerActor(context,args),context,args,direction,text,externalMessageId})}

function runtimeResult({args,context,execution,reply,command='elan_unified_runtime'}){
  return{message:String(args?.message||'').trim(),reply,provider:'elankav',model:'elan-unified-runtime',responseId:null,status:'completed',usage:null,suppressDelivery:false,command,jobId:null,ownerCommercialQuery:true,ownerCrmCommand:false,ownerBusinessCommand:true,actorRole:execution?.actor?.role||'owner',actorId:execution?.actor?.actorId||'owner',accessScopes:execution?.actor?.scopes||['*'],runtimeVersion:execution?.version||'1.0.0',knowledgeAvailable:true,historyMessages:null,context:{version:context?.version||null,platform:context?.platform||args?.platform||'ELANVISUAL',channel:context?.channel||args?.channel||'whatsapp',externalUserId:context?.externalUserId||args?.externalUserId||null,ownerMode:true,runtime:'ELAN_UNIFIED_RUNTIME',authority:'CONNECT'}}
}
function formatMeasureFollowUp(execution){const data=execution?.result||{};const status=String(data.status||'').toUpperCase();const item=data.item||{};const name=item.name||data.query||'este producto';const unit=String(item.unit||item.formulaType||'').toUpperCase();if(status==='REQUIRES_INPUT'&&unit==='AREA_M2')return`${name} no tiene una medida estándar fija en esta tarifa: el precio autorizado se calcula por m². Indicame el ancho y el alto reales y te doy el valor exacto.`;if(status==='REQUIRES_INPUT')return`Para ${name}, CONNECT requiere la medida específica para resolver el precio autorizado. Si querés, decime ancho y alto y lo calculo sin inventar valores.`;return formatAuthorizedPriceResult(execution)}
async function recoverPreviousPriceIntent({context,args}){const memory=await loadConversationMemory({actor:ownerActor(context,args),platform:platformOf(context,args),limit:20});const history=Array.isArray(memory?.history)?memory.history:[];for(let index=history.length-1;index>=0;index-=1){const entry=history[index];if(String(entry?.role||'').toLowerCase()!=='user')continue;const intent=detectAuthorizedPriceLookup(entry?.content);if(intent)return intent}return null}
async function recoverLatestDesignCode({context,args}){const memory=await loadConversationMemory({actor:ownerActor(context,args),platform:platformOf(context,args),limit:30});const history=Array.isArray(memory?.history)?memory.history:[];for(let index=history.length-1;index>=0;index-=1){const content=String(history[index]?.content||'');const match=content.match(/\b(DESIGN-[A-Z0-9-]+)\b/i);if(match?.[1])return match[1].toUpperCase()}return null}

function quotationRows(execution){const result=execution?.result;const data=result?.data??result;if(Array.isArray(data))return data;if(Array.isArray(data?.quotations))return data.quotations;if(Array.isArray(data?.results))return data.results;return[]}
function quotationLabel(row){const doc=row?.quotation_document?.publicDocument||row?.publicDocument||{};const customer=doc.customer||row?.customerSnapshot||row?.customer_snapshot||{};return row?.quotationNumber||row?.quotation_number||doc.quotationNumber||`${customer.name||customer.companyName||'Cliente'} — ${row?.projectNumber||row?.project_number||row?.projectId||''}`}
function resolveQuotationByHumanQuery(rows,query){const needle=normalized(query);if(!needle)return[];return rows.filter(row=>normalized(JSON.stringify(row)).includes(needle))}
function contactRows(execution){const result=execution?.result;const data=result?.data??result;if(Array.isArray(data))return data;if(Array.isArray(data?.results))return data.results;return[]}
function contactLabel(row){return row?.name||row?.displayName||row?.tradeName||row?.companyName||row?.label||row?.id||'contacto'}

async function executeDesignSendFollowUp({intent,context,args}){
  try{
    const requestCode=await recoverLatestDesignCode({context,args});
    if(!requestCode)return runtimeResult({args,context,execution:{actor:ownerActor(context,args),version:'1.0.0'},reply:'No encontré una propuesta reciente para enviar. Indicame cuál propuesta querés usar.',command:'enviar_propuesta_diseno'});
    const search=await executeThroughConnect({channel:channelOf(context,args),actor:ownerActor(context,args),tool:'buscar_contacto',arguments:{query:intent.query}});
    const matches=contactRows(search);
    if(!matches.length)return runtimeResult({args,context,execution:search,reply:`No encontré el contacto “${intent.query}”. No envié la propuesta.`,command:'enviar_propuesta_diseno'});
    if(matches.length>1)return runtimeResult({args,context,execution:search,reply:`Encontré varias coincidencias para “${intent.query}”: ${matches.slice(0,8).map(contactLabel).join('; ')}. Decime cuál querés usar.`,command:'enviar_propuesta_diseno'});
    const target=matches[0];const phone=String(target?.whatsapp||target?.phone||'').trim();
    if(!phone)return runtimeResult({args,context,execution:search,reply:`${contactLabel(target)} no tiene un WhatsApp válido registrado. No envié la propuesta.`,command:'enviar_propuesta_diseno'});
    const execution=await executeThroughConnect({channel:channelOf(context,args),actor:ownerActor(context,args),tool:'enviar_propuesta_diseno',arguments:{requestCode,phone,caption:`ELANVISUAL | Propuesta ${requestCode}`}});
    return runtimeResult({args,context,execution,reply:`✅ Propuesta ${requestCode} enviada por WhatsApp a ${contactLabel(target)}.`,command:'enviar_propuesta_diseno'});
  }catch(error){console.error('[ELAN_DESIGN_SEND_FAILED]',{code:error?.code||null,message:error?.message||null});return runtimeResult({args,context,execution:{actor:ownerActor(context,args),version:'1.0.0'},reply:`No pude enviar la propuesta. Error: ${error?.code||'DESIGN_SEND_FAILED'}. No hice un envío alternativo.`,command:'enviar_propuesta_diseno'})}
}

async function executeQuotationImageIntent({intent,context,args}){
  if(!intent.query)return runtimeResult({args,context,execution:{actor:ownerActor(context,args),version:'1.0.0'},reply:'Recibí la imagen. Decime a qué cotización querés agregarla, por nombre del cliente o trabajo.',command:'cargar_imagen_cotizacion'});
  try{
    const search=await executeThroughConnect({channel:channelOf(context,args),actor:ownerActor(context,args),tool:'buscar_cotizacion',arguments:{}});const matches=resolveQuotationByHumanQuery(quotationRows(search),intent.query);
    if(!matches.length)return runtimeResult({args,context,execution:search,reply:`Recibí la imagen, pero no encontré una cotización que coincida con “${intent.query}”. No hice cambios.`,command:'cargar_imagen_cotizacion'});
    if(matches.length>1)return runtimeResult({args,context,execution:search,reply:`Recibí la imagen, pero encontré varias cotizaciones: ${matches.slice(0,8).map(quotationLabel).join('; ')}. Decime cuál querés usar.`,command:'cargar_imagen_cotizacion'});
    const target=matches[0];const projectId=String(target?.projectId||target?.project_id||target?.quotation_document?.publicDocument?.project?.projectId||'').trim();
    if(!projectId)return runtimeResult({args,context,execution:search,reply:'Encontré la cotización, pero CONNECT no devolvió su proyecto operativo. No cargué la imagen.',command:'cargar_imagen_cotizacion'});
    const media=await downloadWahaMedia({url:intent.media.url});const mimeType=String(media?.mimeType||intent.media.mimeType||'').split(';')[0].toLowerCase();
    if(!mimeType.startsWith('image/'))return runtimeResult({args,context,execution:search,reply:'El archivo recibido no fue reconocido como imagen. No modifiqué la cotización.',command:'cargar_imagen_cotizacion'});
    const execution=await executeThroughConnect({channel:channelOf(context,args),actor:ownerActor(context,args),tool:'cargar_imagen_cotizacion',arguments:{projectId,imageBase64:media.buffer.toString('base64'),mimeType,filename:intent.media.filename||'whatsapp-image',...(intent.itemId?{itemId:intent.itemId}:{}),mode:'add'}});
    return runtimeResult({args,context,execution,reply:`✅ Imagen agregada a ${quotationLabel(target)}. CONNECT confirmó la actualización de la cotización.`,command:'cargar_imagen_cotizacion'});
  }catch(error){console.error('[ELAN_QUOTATION_IMAGE_FAILED]',{code:error?.code||null,message:error?.message||null});return runtimeResult({args,context,execution:{actor:ownerActor(context,args),version:'1.0.0'},reply:`No pude cargar la imagen en la cotización. Error: ${error?.code||'QUOTATION_IMAGE_FAILED'}. No hice cambios alternativos.`,command:'cargar_imagen_cotizacion'})}
}

async function executeGenericOwnerCommand({command,context,args}){
  try{const outcome=await executeOwnerUnifiedCommand({command,actor:ownerActor(context,args),channel:channelOf(context,args)});if(!outcome?.handled)return null;return runtimeResult({args,context,execution:outcome.execution||{actor:ownerActor(context,args),version:'1.0.0'},reply:outcome.reply,command:outcome.tool||'elan_unified_runtime'})}
  catch(error){console.error('[ELAN_UNIFIED_OWNER_COMMAND_FAILED]',{code:error?.code||null,message:error?.message||null});return runtimeResult({args,context,execution:{actor:ownerActor(context,args),version:'1.0.0'},reply:`No pude completar la operación en CONNECT. Error: ${error?.code||'ELAN_RUNTIME_EXECUTION_FAILED'}. No hice cambios alternativos.`,command:command?.tool||'elan_unified_runtime'})}
}

async function executeEntityCreateContinuity({continuity,context,args}){
  if(!continuity?.handled)return null;
  if(!continuity.command){return runtimeResult({args,context,execution:{actor:ownerActor(context,args),version:'1.0.0'},reply:continuity.reply||'Necesito un dato adicional para completar el registro.',command:'owner_entity_create_continuity'})}
  try{
    const outcome=await executeOwnerUnifiedCommand({command:continuity.command,actor:ownerActor(context,args),channel:channelOf(context,args)});
    if(!outcome?.handled){const error=new Error('La operación pendiente no fue ejecutada por el runtime oficial.');error.code='OWNER_ENTITY_CREATE_CONTINUITY_NOT_EXECUTED';throw error}
    if(continuity.clearOnSuccess)await clearPendingEntityCreate();
    return runtimeResult({args,context,execution:outcome.execution||{actor:ownerActor(context,args),version:'1.0.0'},reply:outcome.reply,command:outcome.tool||continuity.command.tool||'owner_entity_create_continuity'});
  }catch(error){
    console.error('[OWNER_ENTITY_CREATE_CONTINUITY_FAILED]',{code:error?.code||null,message:error?.message||null,tool:continuity.command?.tool||null});
    return runtimeResult({args,context,execution:{actor:ownerActor(context,args),version:'1.0.0'},reply:`No pude completar el registro en CONNECT. Error: ${error?.code||'OWNER_ENTITY_CREATE_CONTINUITY_FAILED'}. Conservé los datos pendientes para que puedas corregirlos o cancelar.`,command:continuity.command?.tool||'owner_entity_create_continuity'});
  }
}

function installElanUnifiedRuntimeMessagePatch(messageService=require('./messageService')){
  installOwnerBusinessProcessMessageGateway(messageService);if(!messageService||typeof messageService.processMessage!=='function')throw new TypeError('messageService.processMessage no está disponible');if(messageService[INSTALL_MARK])return messageService.processMessage;
  const originalProcessMessage=messageService.processMessage;
  messageService.processMessage=async function processMessageWithUnifiedRuntime(args={}){
    const context=buildContext({message:args.message,source:'elan-unified-runtime-whatsapp',platform:args.platform,channel:args.channel,externalUserId:args.externalUserId,phone:args.phone,metadata:args.metadata&&typeof args.metadata==='object'?args.metadata:{}});const isOwner=Boolean(context?.owner?.isOwner);
    const actor=await resolveRuntimeActor(context,args);
    await persistRuntimeTurn({actor,context,args,direction:'inbound',text:String(args.message||'').trim(),externalMessageId:args?.metadata?.messageId||null});
    if(!isOwner){
      const result=await originalProcessMessage(args);
      if(result?.reply&&result?.suppressDelivery!==true)await persistRuntimeTurn({actor,context,args,direction:'outbound',text:result.reply,externalMessageId:result?.responseId?'reply:'+result.responseId:null});
      return result;
    }

    const imageIntent=detectQuotationImageIntent(args.message,args.metadata||{});if(imageIntent){const result=await executeQuotationImageIntent({intent:imageIntent,context,args});await persistOwnerTurn({context,args,direction:'outbound',text:result.reply});return result}
    const designSendIntent=detectDesignSendFollowUp(args.message);if(designSendIntent){const result=await executeDesignSendFollowUp({intent:designSendIntent,context,args});await persistOwnerTurn({context,args,direction:'outbound',text:result.reply});return result}

    let intent=detectAuthorizedPriceLookup(args.message);let measureFollowUp=false;if(!intent&&detectPriceMeasureFollowUp(args.message)){try{intent=await recoverPreviousPriceIntent({context,args});measureFollowUp=Boolean(intent)}catch(error){console.error('[ELAN_UNIFIED_RUNTIME_MEMORY_LOOKUP_FAILED]',{code:error?.code||null,message:error?.message||null})}}
    if(intent){let result;try{const execution=await executeThroughConnect({channel:channelOf(context,args),actor:ownerActor(context,args),tool:intent.tool,arguments:intent.arguments});const reply=measureFollowUp?formatMeasureFollowUp(execution):formatAuthorizedPriceResult(execution);console.log('[ELAN_UNIFIED_RUNTIME_EXECUTE]',{channel:'whatsapp',tool:intent.tool,status:execution?.result?.status||'OK',followUp:measureFollowUp});result=runtimeResult({args,context,execution,reply,command:intent.tool})}catch(error){console.error('[ELAN_UNIFIED_RUNTIME_FAILED]',{channel:'whatsapp',tool:intent.tool,code:error?.code||null});result=runtimeResult({args,context,execution:{actor:ownerActor(context,args),version:'1.0.0'},reply:`No pude consultar la autoridad comercial de CONNECT. Error: ${error?.code||'ELAN_RUNTIME_EXECUTION_FAILED'}. No voy a inventar un precio.`,command:intent.tool})}await persistOwnerTurn({context,args,direction:'outbound',text:result.reply});return result}

    try{
      const continuity=await handleOwnerEntityCreateContinuity({message:args.message,actorKey:context?.phone||args?.phone||context?.externalUserId||args?.externalUserId||''});
      if(continuity?.handled){const result=await executeEntityCreateContinuity({continuity,context,args});await persistOwnerTurn({context,args,direction:'outbound',text:result.reply});return result}
    }catch(error){console.error('[OWNER_ENTITY_CREATE_CONTINUITY_STATE_FAILED]',{code:error?.code||null,message:error?.message||null})}

    try{
      const memory=await loadConversationMemory({actor:ownerActor(context,args),platform:platformOf(context,args),limit:30});
      if(shouldResolveOwnerSemanticIntent(args.message,memory?.history||[])){
        const semantic=await resolveOwnerSemanticIntent({message:args.message,history:memory?.history||[]});
        const semanticCommand=semanticIntentToBusinessCommand(semantic);
        if(semanticCommand){
          const execution=await executeOwnerBusinessGatewayCommand(semanticCommand);
          if(execution?.handled){
            const result=runtimeResult({
              args,
              context,
              execution:{actor:ownerActor(context,args),version:'1.0.0'},
              reply:execution.outputText,
              command:semanticCommand.type
            });
            const previousState=memory?.workingState&&typeof memory.workingState==='object'?memory.workingState:{};
            const rows=Array.isArray(execution?.result?.rows)?execution.result.rows:[];
            const prepared=Array.isArray(execution?.result?.prepared)?execution.result.prepared:[];
            const nextState={
              ...previousState,
              lastIntent:semantic.intent,
              activeCustomerReference:semantic.customerReference||previousState.activeCustomerReference||null,
              lastUserMessage:String(args.message||'').trim(),
              lastActionAt:new Date().toISOString(),
              ...(rows.length?{
                lastQuotationNumbers:rows.map(row=>row?.quotationNumber||row?.quotation_number).filter(Boolean),
                lastQuotationIds:rows.map(row=>row?.quotationId||row?.quotation_id||row?.id).filter(Boolean),
                lastQuotationProjectIds:rows.map(row=>row?.projectId||row?.project_id).filter(Boolean)
              }:{}),
              ...(prepared.length?{
                pendingQuotationSendNumbers:prepared.map(entry=>entry?.quotation?.quotationNumber).filter(Boolean),
                pendingQuotationSendIds:prepared.map(entry=>entry?.quotation?.quotationId).filter(Boolean)
              }:{})
            };
            await persistUnifiedWorkingState({actor:ownerActor(context,args),platform:platformOf(context,args),workingState:nextState,safe:true});
            await persistOwnerTurn({context,args,direction:'outbound',text:result.reply});
            return result;
          }
        }
      }
    }catch(error){
      console.error('[OWNER_SEMANTIC_ROUTE_FAILED]',{code:error?.code||null,message:error?.message||String(error)});
    }

    const unifiedCommand=detectOwnerUnifiedCommand(args.message);if(unifiedCommand){const result=await executeGenericOwnerCommand({command:unifiedCommand,context,args});if(result){await persistOwnerTurn({context,args,direction:'outbound',text:result.reply});return result}}
    const result=await originalProcessMessage(args);if(result?.reply&&result?.suppressDelivery!==true)await persistOwnerTurn({context,args,direction:'outbound',text:result.reply,externalMessageId:result.responseId?'elan:'+result.responseId:null});return result;
  };
  Object.defineProperty(messageService,INSTALL_MARK,{value:true,enumerable:false,configurable:false,writable:false});console.log('[ELAN_UNIFIED_RUNTIME_INSTALLED]',{boundary:'processMessage',channels:['whatsapp','copilot'],authority:'CONNECT',ownerTools:'complete',entityCreateContinuity:true});return messageService.processMessage;
}

module.exports={detectAuthorizedPriceLookup,detectPriceMeasureFollowUp,detectQuotationImageIntent,detectDesignSendFollowUp,executeEntityCreateContinuity,installElanUnifiedRuntimeMessagePatch,resolveRuntimeActor,persistRuntimeTurn};
