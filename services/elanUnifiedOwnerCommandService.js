'use strict';

const { executeThroughConnect } = require('./elanUnifiedRuntimeService');

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function labeledValue(message, labels) {
  const lines = String(message || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const normalized = normalize(line);
    for (const label of labels) {
      const prefix = `${normalize(label)}:`;
      if (normalized.startsWith(prefix)) return line.slice(line.indexOf(':') + 1).trim();
    }
  }
  return '';
}

function inlineValue(message, labels) {
  const raw = String(message || '');
  for (const label of labels) {
    const expression = new RegExp(`\\b${label}\\s*[:=]?\\s*([^,;\\n]+)`, 'i');
    const match = raw.match(expression);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function field(message, labels) { return labeledValue(message, labels) || inlineValue(message, labels); }
function digits(value) { return String(value || '').replace(/\D/g, ''); }

function entityType(raw) {
  const text = normalize(raw);
  if (/\bclientes?\b/.test(text)) return 'customer';
  if (/\b(proveedor|proveedoras?|provedor|provedores)\b/.test(text)) return 'provider';
  if (/\b(vendedor|vendedora|vendedores|vendedoras)\b/.test(text)) return 'seller';
  if (/\b(familia|familiar|familiares)\b/.test(text)) return 'family';
  return null;
}

function singularWord(type) { return ({ customer:'cliente', provider:'proveedor', seller:'vendedor', family:'familiar' })[type]; }
function searchTool(type) { return ({ customer:'buscar_cliente', provider:'buscar_proveedor', seller:'buscar_vendedor', family:'buscar_familiar' })[type]; }
function createTool(type) { return ({ customer:'crear_cliente', provider:'crear_proveedor', seller:'crear_vendedor', family:'crear_familiar' })[type]; }
function editTool(type) { return ({ customer:'editar_cliente', provider:'editar_proveedor', seller:'editar_vendedor', family:'editar_familiar' })[type]; }
function deactivateTool(type) { return ({ customer:'desactivar_cliente', provider:'desactivar_proveedor', seller:'desactivar_vendedor', family:'desactivar_familiar' })[type]; }
function idField(type) { return ({ customer:'customerId', provider:'providerId', seller:'sellerId', family:'familyId' })[type]; }

function afterEntity(message, type) {
  const word = singularWord(type);
  const regex = new RegExp(`\\b(?:${word}|${word}a|${word}es|familia)\\b\\s+(.+)$`, 'i');
  const match = String(message || '').match(regex);
  if (!match?.[1]) return '';
  return match[1].split(/(?:\s+(?:whatsapp|wasap|telefono|teléfono|celular|email|correo|empresa|negocio|direccion|dirección|ciudad|relacion|relación|zona|plataforma|plataformas)\s*[:=]?|[,;])/i)[0].trim();
}

function createData(type, message) {
  const name = field(message, ['nombre','name']) || afterEntity(message, type);
  const whatsapp = field(message, ['whatsapp','wasap','celular']);
  const phone = field(message, ['telefono','teléfono']);
  const email = field(message, ['email','correo']);
  if (type === 'customer') return { name, ...(field(message,['empresa','negocio','compania','compañia']) ? { companyName:field(message,['empresa','negocio','compania','compañia']) } : {}), ...(whatsapp?{whatsapp}:{}), ...(phone?{phone}:{}), ...(email?{email}:{}), ...(field(message,['direccion','dirección'])?{address:field(message,['direccion','dirección'])}:{}), ...(field(message,['ciudad','municipio'])?{city:field(message,['ciudad','municipio'])}:{}) };
  if (type === 'provider') return { tradeName:name, ...(field(message,['razon social','razón social'])?{legalName:field(message,['razon social','razón social'])}:{}), ...(field(message,['contacto'])?{contactName:field(message,['contacto'])}:{}), ...(whatsapp?{whatsapp}:{}), ...(phone?{phone}:{}), ...(email?{email}:{}), platforms:['ELANVISUAL'], kinds:['materials_products'] };
  if (type === 'seller') return { displayName:name, ...(whatsapp?{whatsapp}:{}), ...(phone?{phone}:{}), ...(email?{email}:{}), ...(field(message,['zona'])?{zone:field(message,['zona'])}:{}) };
  return { displayName:name, ...(field(message,['relacion','relación','parentesco'])?{relation:field(message,['relacion','relación','parentesco'])}:{}), ...(whatsapp?{whatsapp}:{}), ...(phone?{phone}:{}), ...(email?{email}:{}), platforms:['ELANVISUAL'] };
}

function patchData(type, message) {
  const data = {};
  const whatsapp = field(message,['whatsapp','wasap','celular']); if (whatsapp) data.whatsapp = whatsapp;
  const phone = field(message,['telefono','teléfono']); if (phone) data.phone = phone;
  const email = field(message,['email','correo']); if (email) data.email = email;
  const name = field(message,['nuevo nombre','nombre']);
  if (name) {
    if (type === 'customer') data.name = name;
    if (type === 'provider') data.tradeName = name;
    if (type === 'seller' || type === 'family') data.displayName = name;
  }
  const address = field(message,['direccion','dirección']); if (address && (type === 'customer' || type === 'provider')) data.address = address;
  const city = field(message,['ciudad']); if (city && (type === 'customer' || type === 'provider')) data.city = city;
  const relation = field(message,['relacion','relación','parentesco']); if (relation && type === 'family') data.relation = relation;
  const zone = field(message,['zona']); if (zone && type === 'seller') data.zone = zone;
  return data;
}

function targetFromMutation(message, type) {
  const raw = String(message || '');
  const word = singularWord(type);
  const match = raw.match(new RegExp(`\\b(?:${word}|${word}a|familia)\\b\\s+(.+?)(?=\\s+(?:whatsapp|wasap|telefono|teléfono|celular|email|correo|nuevo nombre|nombre|direccion|dirección|ciudad|relacion|relación|parentesco|zona)\\s*[:=]?|[,;]|$)`, 'i'));
  return match?.[1]?.trim() || '';
}

function detectMessageCommand(message) {
  const raw = String(message || '').trim();
  const match = raw.match(/^(?:elan[\s,:-]+)?(?:escribile|escribele|mandale\s+(?:un\s+)?mensaje|enviale\s+(?:un\s+)?mensaje|decile)\s+(?:a\s+)?(.+?)\s+(?:que|:)[\s]+(.+)$/i);
  if (!match) return null;
  const recipientRaw = match[1].trim();
  const text = match[2].trim();
  const type = entityType(recipientRaw);
  const query = recipientRaw.replace(/\b(cliente|proveedor|provedor|vendedor|vendedora|familiar|familia)\b/ig,'').trim();
  return { tool:'enviar_mensaje_whatsapp', arguments:{ ...(type?{recipientType:type}:{}), query:query || recipientRaw, text } };
}

function detectDesignCommand(message) {
  const raw = String(message || '').trim();
  if (!/(dise[nñ]a|dise[nñ]ame|haceme\s+una\s+propuesta|hazme\s+una\s+propuesta|crea\s+una\s+propuesta|genera\s+una\s+propuesta)/i.test(raw)) return null;
  const dimension = normalize(raw).match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/);
  const project = { requestType:'design', designNotes:raw };
  if (dimension) { project.widthCm = Number(dimension[1].replace(',','.')); project.heightCm = Number(dimension[2].replace(',','.')); }
  return { tool:'crear_propuesta_diseno', arguments:{ customer:{}, project, files:[], source:'owner-whatsapp' } };
}

function detectEntityCommand(message) {
  const type = entityType(message); if (!type) return null;
  const text = normalize(message);
  if (/\b(busca|buscar|encuentra|encontra|localiza|lista|listar|muestra|mostrar)\b/.test(text)) {
    const query = afterEntity(message,type) || field(message,['nombre','query']);
    return { tool:searchTool(type), arguments:{ query:query || singularWord(type) } };
  }
  if (/\b(agrega|agregar|crea|crear|registra|registrar)\b/.test(text)) {
    const data = createData(type,message);
    const principal = data.name || data.tradeName || data.displayName;
    if (!principal) return { invalid:`Necesito el nombre del ${singularWord(type)}.` };
    return { tool:createTool(type), arguments:{ data } };
  }
  if (/\b(edita|editar|actualiza|actualizar|cambia|cambiar|modifica|modificar)\b/.test(text)) {
    const query = targetFromMutation(message,type); const data = patchData(type,message);
    if (!query) return { invalid:`Necesito saber qué ${singularWord(type)} querés editar.` };
    if (!Object.keys(data).length) return { invalid:'Indicame qué dato querés cambiar.' };
    return { resolve:{ type, query }, tool:editTool(type), idField:idField(type), arguments:{ data } };
  }
  if (/\b(desactiva|desactivar|elimina|eliminar|borra|borrar)\b/.test(text)) {
    const query = targetFromMutation(message,type) || afterEntity(message,type);
    if (!query) return { invalid:`Necesito saber qué ${singularWord(type)} querés desactivar.` };
    return { resolve:{ type, query }, tool:deactivateTool(type), idField:idField(type), arguments:{} };
  }
  return null;
}

function detectOwnerUnifiedCommand(message) {
  return detectMessageCommand(message) || detectDesignCommand(message) || detectEntityCommand(message);
}

function unwrapList(execution) {
  const result = execution?.result;
  const data = result?.data ?? result;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.sellers)) return data.sellers;
  return [];
}

function formatEntity(item) {
  return item?.name || item?.displayName || item?.tradeName || item?.companyName || item?.label || item?.id || 'registro';
}

function formatExecution(tool, execution) {
  const result = execution?.result;
  const data = result?.data ?? result;
  if (tool.startsWith('buscar_')) {
    const rows = unwrapList(execution);
    if (!rows.length) return 'No encontré registros que coincidan.';
    return rows.slice(0,10).map((row,index)=>`${index+1}. ${formatEntity(row)}${row.whatsapp?` — ${row.whatsapp}`:''}`).join('\n');
  }
  if (tool === 'enviar_mensaje_whatsapp') return `✅ Mensaje enviado a ${formatEntity(data?.recipient)} por WhatsApp.`;
  if (tool === 'crear_propuesta_diseno') {
    const output = data?.result || data;
    return `✅ Propuesta de diseño creada${output?.requestCode?` (${output.requestCode})`:''}. Estado: ${output?.status || 'ai_pending'}.`;
  }
  if (tool.startsWith('crear_')) return `✅ ${formatEntity(data)} creado correctamente en CONNECT.`;
  if (tool.startsWith('editar_')) return `✅ ${formatEntity(data)} actualizado correctamente.`;
  if (tool.startsWith('desactivar_')) return `✅ ${formatEntity(data)} desactivado. Se conservó su trazabilidad histórica.`;
  return '✅ Operación completada en CONNECT.';
}

async function executeOwnerUnifiedCommand({ command, actor, channel = 'whatsapp', env = process.env }) {
  if (command?.invalid) return { handled:true, reply:command.invalid, execution:null, tool:null };
  if (!command?.tool) return { handled:false };
  const args = { ...(command.arguments || {}) };
  if (command.resolve) {
    const search = await executeThroughConnect({ actor, channel, tool:searchTool(command.resolve.type), arguments:{query:command.resolve.query}, env });
    const matches = unwrapList(search);
    if (!matches.length) return { handled:true, reply:`No encontré ${singularWord(command.resolve.type)} “${command.resolve.query}”.`, execution:search, tool:searchTool(command.resolve.type) };
    if (matches.length > 1) return { handled:true, reply:`Encontré varias coincidencias: ${matches.slice(0,10).map(formatEntity).join('; ')}. Decime cuál querés usar.`, execution:search, tool:searchTool(command.resolve.type) };
    args[command.idField] = matches[0].id || matches[0].sourceId || matches[0].customerId || matches[0].providerId || matches[0].sellerId || matches[0].familyId;
  }
  const execution = await executeThroughConnect({ actor, channel, tool:command.tool, arguments:args, env });
  return { handled:true, reply:formatExecution(command.tool,execution), execution, tool:command.tool };
}

module.exports = { detectOwnerUnifiedCommand, executeOwnerUnifiedCommand, formatExecution };
