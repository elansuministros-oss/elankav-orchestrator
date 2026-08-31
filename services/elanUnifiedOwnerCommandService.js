'use strict';

const { executeThroughConnect } = require('./elanUnifiedRuntimeService');
const connect = require('./ownerBusinessConnectClient');
const {
  detectOwnerElanGoCommand,
  executeOwnerElanGoCommand
} = require('./ownerElanGoControlService');

function normalize(value) { return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '); }
function labeledValue(message, labels) { const lines=String(message||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean); for(const line of lines){const normalized=normalize(line);for(const label of labels){const prefix=`${normalize(label)}:`;if(normalized.startsWith(prefix))return line.slice(line.indexOf(':')+1).trim()}}return''; }
function inlineValue(message, labels) { const raw=String(message||'');for(const label of labels){const expression=new RegExp(`\\b${label}\\s*[:=]?\\s*([^,;\\n]+)`,'i');const match=raw.match(expression);if(match?.[1])return match[1].trim()}return''; }
function field(message,labels){return labeledValue(message,labels)||inlineValue(message,labels)}
function entityType(raw){const text=normalize(raw);if(/\bclientes?\b/.test(text))return'customer';if(/\b(proveedor|proveedora|proveedores|provedor|provedores)\b/.test(text))return'provider';if(/\b(vendedor|vendedora|vendedores|vendedoras)\b/.test(text))return'seller';if(/\b(familia|familiar|familiares)\b/.test(text))return'family';return null}
function singularWord(type){return({customer:'cliente',provider:'proveedor',seller:'vendedor',family:'familiar'})[type]}
function searchTool(type){return({customer:'buscar_cliente',provider:'buscar_proveedor',seller:'buscar_vendedor',family:'buscar_familiar'})[type]}
function createTool(type){return({customer:'crear_cliente',provider:'crear_proveedor',seller:'crear_vendedor',family:'crear_familiar'})[type]}
function editTool(type){return({customer:'editar_cliente',provider:'editar_proveedor',seller:'editar_vendedor',family:'editar_familiar'})[type]}
function deactivateTool(type){return({customer:'desactivar_cliente',provider:'desactivar_proveedor',seller:'desactivar_vendedor',family:'desactivar_familiar'})[type]}
function idField(type){return({customer:'customerId',provider:'providerId',seller:'sellerId',family:'familyId'})[type]}

function entityPattern(type){return({customer:'clientes?',provider:'(?:proveedor|proveedora|proveedores|provedor|provedores)',seller:'(?:vendedor|vendedora|vendedores|vendedoras)',family:'(?:familia|familiar|familiares)'})[type]}
function cleanHumanName(value){return String(value||'').trim().replace(/^(?:llamado|llamada|de\s+nombre|con\s+nombre|el\s+nombre\s+(?:es|:|=)?)\s*/i,'').replace(/^(?:es\s*[:=]?\s*)/i,'').trim()}
function cleanMutationValue(value){return String(value||'').trim().replace(/^(?:a|por|en|es)\s*[:=]?\s*/i,'').trim()}
function afterEntity(message,type){const regex=new RegExp(`\\b${entityPattern(type)}\\b\\s+(.+)$`,'i');const match=String(message||'').match(regex);if(!match?.[1])return'';const raw=match[1].split(/(?:\s+(?:y\s+)?(?:su\s+)?(?:numero|número)?\s*(?:de\s+)?(?:whatsapp|wasap|telefono|teléfono|celular|email|correo|empresa|negocio|direccion|dirección|ciudad|relacion|relación|zona|plataforma|plataformas)\b\s*(?:es)?\s*[:=]?|[,;])/i)[0].trim();return cleanHumanName(raw)}
function explicitCreateName(message,type){
  const raw=String(message||'');
  const entity=entityPattern(type);
  const stop='(?=\\s+(?:y\\s+)?(?:su\\s+)?(?:numero|número)?\\s*(?:de\\s+)?(?:whatsapp|wasap|telefono|teléfono|celular|email|correo|empresa|negocio|direccion|dirección|ciudad|relacion|relación|zona|plataforma|plataformas)\\b|[,;]|$)';
  const patterns=[
    new RegExp(`\\b${entity}\\b[\\s,:-]*(?:el\\s+)?nombre\\s*(?:es|:|=)\\s*(.+?)${stop}`,'i'),
    new RegExp(`\\b${entity}\\b\\s+(?:llamado|llamada|de\\s+nombre|con\\s+nombre)\\s+(.+?)${stop}`,'i'),
    new RegExp(`\\b${entity}\\b[\\s,:-]+(?:se\\s+llama\\s+)(.+?)${stop}`,'i')
  ];
  for(const pattern of patterns){const match=raw.match(pattern);if(match?.[1])return cleanHumanName(match[1]);}
  return'';
}
function explicitNaturalWhatsApp(message){const raw=String(message||'');const match=raw.match(/(?:su\s+)?(?:numero|número)?\s*(?:de\s+)?(?:whatsapp|wasap)\s*(?:es|:|=)?\s*([+\d][\d\s-]{6,})/i);return match?.[1]?.trim()||''}
function explicitNaturalPhone(message){const raw=String(message||'');const match=raw.match(/(?:su\s+)?(?:numero|número)?\s*(?:de\s+)?(?:telefono|teléfono|celular)\s*(?:es|:|=)?\s*([+\d][\d\s-]{6,})/i);return match?.[1]?.trim()||''}

function createData(type,message){
  const name=explicitCreateName(message,type)||cleanHumanName(field(message,['nombre','name']))||afterEntity(message,type);
  const whatsapp=explicitNaturalWhatsApp(message)||cleanMutationValue(field(message,['whatsapp','wasap','celular']));
  const phone=explicitNaturalPhone(message)||cleanMutationValue(field(message,['telefono','teléfono']));
  const email=cleanMutationValue(field(message,['email','correo']));
  if(type==='customer')return{name,...(field(message,['empresa','negocio','compania','compañia'])?{companyName:cleanMutationValue(field(message,['empresa','negocio','compania','compañia']))}:{}),...(whatsapp?{whatsapp}:{}),...(phone?{phone}:{}),...(email?{email}:{}),...(field(message,['direccion','dirección'])?{address:cleanMutationValue(field(message,['direccion','dirección']))}:{}),...(field(message,['ciudad','municipio'])?{city:cleanMutationValue(field(message,['ciudad','municipio']))}:{})};
  if(type==='provider')return{tradeName:name,...(field(message,['razon social','razón social'])?{legalName:cleanMutationValue(field(message,['razon social','razón social']))}:{}),...(field(message,['contacto'])?{contactName:cleanMutationValue(field(message,['contacto']))}:{}),...(whatsapp?{whatsapp}:{}),...(phone?{phone}:{}),...(email?{email}:{}),platforms:['ELANVISUAL'],kinds:['materials_products']};
  if(type==='seller')return{displayName:name,...(whatsapp?{whatsapp}:{}),...(phone?{phone}:{}),...(email?{email}:{}),...(field(message,['zona'])?{zone:cleanMutationValue(field(message,['zona']))}:{})};
  return{displayName:name,...(field(message,['relacion','relación','parentesco'])?{relation:cleanMutationValue(field(message,['relacion','relación','parentesco']))}:{}),...(whatsapp?{whatsapp}:{}),...(phone?{phone}:{}),...(email?{email}:{}),platforms:['ELANVISUAL']};
}

function explicitNewName(message){const raw=String(message||'');const match=raw.match(/(?:cambia|cambiar|cambiale|actualiza|actualizar|edita|editar|modifica|modificar)?\s*(?:el\s+)?nombre\s+(?:a|por)\s+(.+?)(?=\s+(?:y\s+)?(?:el\s+)?(?:whatsapp|wasap|telefono|teléfono|celular|email|correo|direccion|dirección|ciudad|relacion|relación|parentesco|zona)\b|[,;]|$)/i);return match?.[1]?.trim()||''}
function explicitPhone(message){return explicitNaturalPhone(message)||String(message||'').match(/(?:cambia|cambiar|cambiale|actualiza|actualizar|edita|editar|modifica|modificar)?\s*(?:el\s+)?(?:telefono|teléfono|celular)\s+(?:a|por|en)?\s*[:=]?\s*([+\d][\d\s-]{6,})/i)?.[1]?.trim()||''}
function explicitWhatsApp(message){return explicitNaturalWhatsApp(message)||String(message||'').match(/(?:cambia|cambiar|cambiale|actualiza|actualizar|edita|editar|modifica|modificar)?\s*(?:el\s+)?(?:whatsapp|wasap)\s+(?:a|por|en)?\s*[:=]?\s*([+\d][\d\s-]{6,})/i)?.[1]?.trim()||''}
function structuredValues(value){return String(value||'').split(/[;,]/).map(item=>item.trim()).filter(Boolean)}
function providerKinds(value){const text=normalize(value);const kinds=[];if(/\b(material|materiales|producto|productos)\b/.test(text))kinds.push('materials_products');if(/\b(servicio|servicios|subcontrata|subcontratacion|subcontratación)\b/.test(text))kinds.push('services_subcontracting');return kinds}
function patchData(type,message){
  const data={};
  const combinedPhone=cleanMutationValue(field(message,['whatsapp / telefono','whatsapp / teléfono','whatsapp/telefono','whatsapp/teléfono']));
  const whatsapp=combinedPhone||explicitWhatsApp(message)||cleanMutationValue(field(message,['whatsapp','wasap','celular']));if(whatsapp)data.whatsapp=whatsapp;
  const phone=combinedPhone||explicitPhone(message)||cleanMutationValue(field(message,['telefono','teléfono']));if(phone)data.phone=phone;
  const email=cleanMutationValue(field(message,['email','correo']));if(email)data.email=email;
  const name=explicitNewName(message)||cleanMutationValue(field(message,['nuevo nombre']));if(name){if(type==='customer')data.name=name;if(type==='provider')data.tradeName=name;if(type==='seller'||type==='family')data.displayName=name}
  const address=cleanMutationValue(field(message,['direccion','dirección']));if(address&&(type==='customer'||type==='provider'))data.address=address;
  const city=cleanMutationValue(field(message,['ciudad']));if(city&&(type==='customer'||type==='provider'))data.city=city;
  if(type==='provider'){
    const contactName=cleanMutationValue(field(message,['contacto','persona de contacto']));if(contactName)data.contactName=contactName;
    const country=cleanMutationValue(field(message,['pais','país']));if(country)data.country=country;
    const platformsRaw=cleanMutationValue(field(message,['plataforma','plataformas']));if(platformsRaw){const platforms=structuredValues(platformsRaw).map(value=>value.toUpperCase());if(platforms.length)data.platforms=platforms;}
    const kindsRaw=cleanMutationValue(field(message,['tipo','tipos']));if(kindsRaw){const kinds=providerKinds(kindsRaw);if(kinds.length)data.kinds=kinds;}
    const categoryRaw=cleanMutationValue(field(message,['categoria','categoría','categorias','categorías']));if(categoryRaw)data.categories=String(categoryRaw).split(';').map(value=>value.trim()).filter(Boolean);
    const specialtiesRaw=cleanMutationValue(field(message,['especialidad','especialidades']));if(specialtiesRaw){const specialties=structuredValues(specialtiesRaw);if(specialties.length)data.specialties=specialties;}
  }
  const relation=cleanMutationValue(field(message,['relacion','relación','parentesco']));if(relation&&type==='family')data.relation=relation;
  const zone=cleanMutationValue(field(message,['zona']));if(zone&&type==='seller')data.zone=zone;
  return data
}
function targetFromMutation(message,type){
  const raw=String(message||'');
  const firstLine=raw.split(/\r?\n/).map(line=>line.trim()).find(Boolean)||'';
  const entity=entityPattern(type);
  const direct=firstLine.match(new RegExp(`\\b(?:edita|editar|actualiza|actualizar|cambia|cambiar|modifica|modificar)\\s+(?:al\\s+|el\\s+|la\\s+)?${entity}\\b\\s+(.+)$`,'i'));
  if(direct?.[1]){
    const target=direct[1].split(/(?:[ \t]+(?=(?:contacto|persona[ \t]+de[ \t]+contacto|whatsapp|wasap|telefono|teléfono|celular|email|correo|nuevo[ \t]+nombre|nombre|direccion|dirección|ciudad|pais|país|plataforma|plataformas|tipo|tipos|categoria|categoría|categorias|categorías|especialidad|especialidades)[ \t]*[:=]?)|[,;])/i)[0].replace(/[.!?]+$/g,'').trim();
    if(target)return cleanHumanName(target);
  }
  const match=firstLine.match(new RegExp(`\\b${entity}\\b\\s+(.+?)(?=\\s+(?:cambia|cambiar|cambiale|actualiza|actualizar|edita|editar|modifica|modificar)\\b|\\s+(?:whatsapp|wasap|telefono|teléfono|celular|email|correo|nuevo nombre|nombre|direccion|dirección|ciudad|relacion|relación|parentesco|zona|contacto|pais|país|plataforma|plataformas|tipo|tipos|categoria|categoría|categorias|categorías|especialidad|especialidades)\\s*[:=]?|[,;]|$)`,'i'));
  return cleanHumanName((match?.[1]||'').replace(/[.!?]+$/g,'').trim())
}

function detectMessageCommand(message){const raw=String(message||'').trim();const match=raw.match(/^(?:elan[\s,:-]+)?(?:escribile|escribele|mandale\s+(?:un\s+)?mensaje|enviale\s+(?:un\s+)?mensaje|decile)\s+(?:a\s+)?(.+?)\s+(?:que|:)[\s]+(.+)$/i);if(!match)return null;const recipientRaw=match[1].trim();const text=match[2].trim();const type=entityType(recipientRaw);const query=recipientRaw.replace(/\b(cliente|proveedor|provedor|vendedor|vendedora|familiar|familia)\b/ig,'').trim();return{tool:'enviar_mensaje_whatsapp',arguments:{...(type?{recipientType:type}:{}),query:query||recipientRaw,text}}}
function detectDesignStatusCommand(message){const raw=String(message||'').trim();const code=raw.match(/\b(DESIGN-[A-Z0-9-]+)\b/i)?.[1];if(!code)return null;const text=normalize(raw);if(!/\b(consulta|consultar|consultame|consulta|estado|verifica|verificar|verificame)\b/.test(text)&&!/(como\s+va|como\s+esta)/.test(text))return null;return{tool:'consultar_propuesta_diseno',arguments:{requestCode:code.toUpperCase()},ownerStatusLookup:true}}
function detectDesignCommand(message){const raw=String(message||'').trim();if(!/(dise[nñ]a|dise[nñ]ame|haceme\s+una\s+propuesta|hazme\s+una\s+propuesta|crea\s+una\s+propuesta|genera\s+una\s+propuesta)/i.test(raw))return null;const normalized=normalize(raw);const requestType=/\b(logo|logotipo)\b/.test(normalized)?'logo':/\b(rotulo|rotulos|letrero|letreros|senal|senales|senalizacion|acrilico|boton)\b/.test(normalized)?'rotulo':null;if(!requestType)return{invalid:'Indicame si la propuesta es para un rótulo o un logo.'};const dimension=normalized.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/);const project={requestType,designNotes:raw};if(dimension){project.widthCm=Number(dimension[1].replace(',','.'));project.heightCm=Number(dimension[2].replace(',','.'))}return{tool:'crear_propuesta_diseno',arguments:{customer:{},project,files:[],source:'owner-whatsapp'}}}

function requestedStatus(text){if(/\b(activo|activa|activos|activas)\b/.test(text))return'active';if(/\b(inactivo|inactiva|inactivos|inactivas)\b/.test(text))return'inactive';if(/\b(suspendido|suspendida|suspendidos|suspendidas)\b/.test(text))return'suspended';return null}
function detectEntityCommand(message){const type=entityType(message);if(!type)return null;const text=normalize(message);if(/\bcotizacion(?:es)?\b/.test(text))return null;
  const listIntent=/\b(lista|listar|listame|listeme|muestra|mostrar|mostrame|muestrame|dame|cuales|quienes)\b/.test(text);
  const searchIntent=/\b(busca|buscar|buscame|encuentra|encontra|localiza)\b/.test(text);
  if(listIntent||searchIntent){const status=requestedStatus(text);const query=listIntent?'':(afterEntity(message,type)||field(message,['nombre','query']));return{tool:searchTool(type),arguments:query?{query}:{},...(status?{filterStatus:status}:{})}}
  if(/\b(agrega|agregar|crea|crear|registra|registrar)\b/.test(text)){const data=createData(type,message);const principal=data.name||data.tradeName||data.displayName;if(!principal)return{invalid:`Necesito el nombre del ${singularWord(type)}.`};return{tool:createTool(type),arguments:{data}}}
  if(/\b(edita|editar|actualiza|actualizar|cambia|cambiar|modifica|modificar)\b/.test(text)){const query=targetFromMutation(message,type);const data=patchData(type,message);if(!query)return{invalid:`Necesito saber qué ${singularWord(type)} querés editar.`};if(!Object.keys(data).length)return{invalid:'Indicame qué dato querés cambiar.'};return{resolve:{type,query},tool:editTool(type),idField:idField(type),arguments:{data}}}
  if(/\b(elimina|eliminar|borra|borrar)\b/.test(text)){const query=targetFromMutation(message,type)||afterEntity(message,type);if(!query)return{invalid:`Necesito saber qué ${singularWord(type)} querés eliminar.`};if(type!=='seller')return{invalid:`La eliminación física de ${singularWord(type)} todavía no está habilitada. Si querés conservar historial, usá “desactiva”.`};return{resolve:{type,query},tool:'eliminar_vendedor',idField:'sellerId',arguments:{}}}
  if(/\b(desactiva|desactivar)\b/.test(text)){const query=targetFromMutation(message,type)||afterEntity(message,type);if(!query)return{invalid:`Necesito saber qué ${singularWord(type)} querés desactivar.`};return{resolve:{type,query},tool:deactivateTool(type),idField:idField(type),arguments:{}}}
  return null}
function detectOwnerUnifiedCommand(message){
  const elanGoCommand=detectOwnerElanGoCommand(message);
  if(elanGoCommand)return{elanGoCommand};
  return detectMessageCommand(message)||detectDesignStatusCommand(message)||detectDesignCommand(message)||detectEntityCommand(message)
}
function unwrapList(execution){const result=execution?.result;const data=result?.data??result;if(Array.isArray(data))return data;if(Array.isArray(data?.results))return data.results;if(Array.isArray(data?.sellers))return data.sellers;return[]}
function formatEntity(item){return item?.name||item?.displayName||item?.tradeName||item?.companyName||item?.label||item?.id||'registro'}
function formatExecution(tool,execution,options={}){const result=execution?.result;const data=result?.data??result;if(tool.startsWith('buscar_')){let rows=unwrapList(execution);if(options.filterStatus)rows=rows.filter(row=>normalize(row?.status)===normalize(options.filterStatus));if(!rows.length)return options.filterStatus?`No encontré registros con estado ${options.filterStatus}.`:'No encontré registros que coincidan.';return rows.slice(0,10).map((row,index)=>`${index+1}. ${formatEntity(row)}${row.whatsapp?` — ${row.whatsapp}`:''}${row.status?` — ${row.status}`:''}`).join('\n')}if(tool==='enviar_mensaje_whatsapp')return`✅ Mensaje enviado a ${formatEntity(data?.recipient)} por WhatsApp.`;if(tool==='crear_propuesta_diseno'){const output=data?.result||data;return`✅ Propuesta de diseño creada${output?.requestCode?` (${output.requestCode})`:''}. Estado: ${output?.status||'ai_pending'}.`}if(tool==='consultar_propuesta_diseno'){const output=data?.result||data;const error=output?.lastErrorCode?` Error: ${output.lastErrorCode}.`:'';const ready=output?.ready?' Lista para revisión.':'';return`🎨 Propuesta ${output?.requestCode||''}. Estado: ${output?.status||'desconocido'}.${ready}${error}`.trim()}if(tool.startsWith('crear_'))return`✅ ${formatEntity(data)} creado correctamente en CONNECT.`;if(tool.startsWith('editar_'))return`✅ ${formatEntity(data)} actualizado correctamente.`;if(tool.startsWith('desactivar_'))return`✅ ${formatEntity(data)} desactivado. Se conservó su trazabilidad histórica.`;if(tool==='eliminar_vendedor')return`✅ ${formatEntity(data)} eliminado físicamente de CONNECT.`;return'✅ Operación completada en CONNECT.'}

async function executeOwnerUnifiedCommand({command,actor,channel='whatsapp',env=process.env}){
  if(command?.elanGoCommand){
    const outcome=await executeOwnerElanGoCommand(command.elanGoCommand,env);
    if(!outcome?.handled)return{handled:false};
    return{
      handled:true,
      reply:outcome.outputText,
      execution:{
        actor,
        version:'1.0.0',
        result:outcome.control
      },
      tool:'elan_go_control'
    };
  }
  if(command?.invalid)return{handled:true,reply:command.invalid,execution:null,tool:null};
  if(!command?.tool)return{handled:false};const args={...(command.arguments||{})};if(command.ownerStatusLookup){const payload=await connect.requestConnect('/api/v1/business/vqs/owner-design/status',{method:'POST',body:{requestCode:args.requestCode}},env);const execution={result:payload};return{handled:true,reply:formatExecution(command.tool,execution),execution,tool:command.tool}}if(command.resolve){const search=await executeThroughConnect({actor,channel,tool:searchTool(command.resolve.type),arguments:{query:command.resolve.query},env});const matches=unwrapList(search);if(!matches.length)return{handled:true,reply:`No encontré ${singularWord(command.resolve.type)} “${command.resolve.query}”.`,execution:search,tool:searchTool(command.resolve.type)};if(matches.length>1)return{handled:true,reply:`Encontré varias coincidencias: ${matches.slice(0,10).map(formatEntity).join('; ')}. Decime cuál querés usar.`,execution:search,tool:searchTool(command.resolve.type)};args[command.idField]=matches[0].id||matches[0].sourceId||matches[0].customerId||matches[0].providerId||matches[0].sellerId||matches[0].familyId}const execution=await executeThroughConnect({actor,channel,tool:command.tool,arguments:args,env});return{handled:true,reply:formatExecution(command.tool,execution,{filterStatus:command.filterStatus}),execution,tool:command.tool}}

module.exports={detectOwnerUnifiedCommand,executeOwnerUnifiedCommand,formatExecution};