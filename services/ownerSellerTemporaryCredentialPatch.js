'use strict';

const commandService = require('./elanUnifiedOwnerCommandService');
const connect = require('./ownerBusinessConnectClient');

const originalDetect = commandService.detectOwnerUnifiedCommand;
const originalExecute = commandService.executeOwnerUnifiedCommand;

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function detectSellerTemporaryCredential(message) {
  const raw = String(message || '').trim();
  const text = normalize(raw);
  if (!/\b(vendedor|vendedora)\b/.test(text)) return null;
  if (!/\b(contrasena|clave|credencial|acceso)\s+temporal\b/.test(text)) return null;
  if (!/\b(envia|enviar|enviale|mandale|manda|genera|generar|crea|crear|restablece|restablecer)\b/.test(text)) return null;

  const match = raw.match(/\b(?:vendedor|vendedora)\b\s+(.+?)\s*$/i);
  const query = String(match?.[1] || '').trim().replace(/[.!]+$/, '').trim();
  if (!query) return { invalid: 'Decime a qué vendedor querés enviarle la contraseña temporal.' };

  return {
    tool: 'enviar_credencial_temporal_vendedor',
    temporarySellerCredential: true,
    sellerQuery: query,
    arguments: {}
  };
}

function detectSellerAuditByPhone(message) {
  const raw = String(message || '').trim();
  const text = normalize(raw);
  if (!/\b(vendedor|vendedora|vendedores|vendedoras)\b/.test(text)) return null;
  if (!/\b(busca|buscar|buscame|encontra|encuentra|mostra|mostrar|mostrame|muestrame|audita|auditar|datos|informacion)\b/.test(text)) return null;
  const phoneMatch = raw.match(/(?:whatsapp|wasap|telefono|teléfono|celular)\s*[:=]?\s*(\+?[\d\s-]{8,})/i);
  const phone = digits(phoneMatch?.[1] || '');
  if (phone.length < 8) return null;
  return {
    tool: 'auditar_vendedor_por_telefono',
    sellerAuditByPhone: true,
    sellerPhone: phone,
    arguments: {}
  };
}

function detectSellerNameEdit(message) {
  const raw = String(message || '').trim();
  const text = normalize(raw);
  if (!/\b(vendedor|vendedora)\b/.test(text)) return null;
  if (!/\b(edita|editar|actualiza|actualizar|cambia|cambiar|modifica|modificar)\b/.test(text)) return null;

  const nameMatch = raw.match(/(?:cambia|cambiar|cambiale|actualiza|actualizar|edita|editar|modifica|modificar)?\s*(?:el\s+)?nombre\s+(?:a|por)\s*[:=]?\s*(.+?)(?=\r?\n|$)/i);
  const newName = String(nameMatch?.[1] || '').trim().replace(/[.!]+$/, '').trim();
  if (!newName) return null;

  const targetMatch = raw.match(/\b(?:vendedor|vendedora)\b\s+(.+?)(?=\r?\n|$)/i);
  const sellerQuery = String(targetMatch?.[1] || '').trim().replace(/[.!]+$/, '').trim();
  if (!sellerQuery) return { invalid: 'Necesito saber qué vendedor querés editar.' };

  const whatsappMatch = raw.match(/(?:manten[eé]|deja|conserva)?\s*(?:su\s+)?(?:whatsapp|wasap)\s*[:=]?\s*(\+?[\d\s-]{8,})/i);
  return {
    tool: 'editar_vendedor',
    sellerNameEdit: true,
    sellerQuery,
    newName,
    whatsapp: String(whatsappMatch?.[1] || '').trim(),
    arguments: {}
  };
}

function unwrapSellerList(payload) {
  const data = payload?.data ?? payload?.result?.data ?? payload?.result ?? payload;
  return Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
}

function sellerName(seller) {
  return String(seller?.displayName || seller?.name || seller?.legalName || seller?.id || '').trim();
}

function findSellerMatches(sellers, query) {
  const queryDigits = digits(query);
  if (queryDigits.length >= 8) {
    return sellers.filter((seller) => {
      const candidates = [digits(seller?.whatsapp), digits(seller?.phone)].filter(Boolean);
      return candidates.some((value) => value === queryDigits || value.endsWith(queryDigits) || queryDigits.endsWith(value));
    });
  }
  const needle = normalize(query);
  return sellers.filter((seller) => normalize(sellerName(seller)) === needle || normalize(sellerName(seller)).includes(needle));
}

function formatSellerAudit(seller) {
  return [
    '🔎 Vendedor encontrado en CONNECT',
    `Nombre: ${sellerName(seller) || '—'}`,
    `WhatsApp: ${seller?.whatsapp || '—'}`,
    `Teléfono: ${seller?.phone || '—'}`,
    `Correo: ${seller?.email || '—'}`,
    `Código de vendedor: ${seller?.sellerCode || seller?.seller_code || '—'}`,
    `Estado: ${seller?.status || '—'}`,
    `ID: ${seller?.id || seller?.sellerId || '—'}`
  ].join('\n');
}

commandService.detectOwnerUnifiedCommand = function patchedDetectOwnerUnifiedCommand(message) {
  return detectSellerTemporaryCredential(message)
    || detectSellerNameEdit(message)
    || detectSellerAuditByPhone(message)
    || originalDetect(message);
};

commandService.executeOwnerUnifiedCommand = async function patchedExecuteOwnerUnifiedCommand(options = {}) {
  const command = options.command;
  if (!command?.temporarySellerCredential && !command?.sellerAuditByPhone && !command?.sellerNameEdit) return originalExecute(options);
  if (command.invalid) return { handled: true, reply: command.invalid, execution: null, tool: null };

  const env = options.env || process.env;
  const allPayload = await connect.listOwnerSellers('', env);
  const sellers = unwrapSellerList(allPayload);

  if (command.sellerAuditByPhone) {
    const matches = findSellerMatches(sellers, command.sellerPhone);
    if (!matches.length) return { handled: true, reply: `No encontré un vendedor con el teléfono ${command.sellerPhone} en CONNECT.`, execution: allPayload, tool: 'buscar_vendedor' };
    if (matches.length > 1) return { handled: true, reply: `Encontré varias coincidencias para ese teléfono: ${matches.slice(0, 10).map(sellerName).join('; ')}.`, execution: allPayload, tool: 'buscar_vendedor' };
    return { handled: true, reply: formatSellerAudit(matches[0]), execution: allPayload, tool: 'buscar_vendedor' };
  }

  if (command.sellerNameEdit) {
    let matches = findSellerMatches(sellers, command.sellerQuery);
    if (!matches.length) {
      const embeddedPhone = digits(command.sellerQuery);
      if (embeddedPhone.length >= 8) matches = findSellerMatches(sellers, embeddedPhone);
    }
    if (!matches.length) return { handled: true, reply: `No encontré al vendedor “${command.sellerQuery}” en CONNECT.`, execution: allPayload, tool: 'buscar_vendedor' };
    if (matches.length > 1) return { handled: true, reply: `Encontré varias coincidencias: ${matches.slice(0, 10).map(sellerName).join('; ')}. Decime cuál vendedor querés usar.`, execution: allPayload, tool: 'buscar_vendedor' };

    const seller = matches[0];
    const sellerId = String(seller.id || seller.sellerId || '').trim();
    if (!sellerId) throw Object.assign(new Error('CONNECT no devolvió el identificador del vendedor.'), { code: 'SELLER_ID_MISSING', statusCode: 502 });
    const patch = { displayName: command.newName };
    if (command.whatsapp) patch.whatsapp = command.whatsapp;
    const updatedPayload = await connect.updateOwnerSeller(sellerId, patch, env);
    const updated = updatedPayload?.data || updatedPayload?.result?.data || updatedPayload?.result || updatedPayload || {};
    return {
      handled: true,
      reply: `✅ Vendedor actualizado y verificado en CONNECT.\nNombre: ${sellerName(updated) || command.newName}\nWhatsApp: ${updated.whatsapp || command.whatsapp || seller.whatsapp || '—'}\nID: ${updated.id || sellerId}`,
      execution: updatedPayload,
      tool: 'editar_vendedor'
    };
  }

  const query = String(command.sellerQuery || '').trim();
  const matches = findSellerMatches(sellers, query);
  if (!matches.length) {
    return { handled: true, reply: `No encontré al vendedor “${query}” en CONNECT.`, execution: allPayload, tool: 'buscar_vendedor' };
  }
  if (matches.length > 1) {
    const names = matches.slice(0, 10).map(sellerName).join('; ');
    return { handled: true, reply: `Encontré varias coincidencias: ${names}. Decime cuál vendedor querés usar.`, execution: allPayload, tool: 'buscar_vendedor' };
  }

  const seller = matches[0];
  const sellerId = String(seller.id || seller.sellerId || '').trim();
  if (!sellerId) throw Object.assign(new Error('CONNECT no devolvió el identificador del vendedor.'), { code: 'SELLER_ID_MISSING', statusCode: 502 });

  const payload = await connect.requestConnect(
    `/api/v1/business/vqs/owner-directory/sellers/${encodeURIComponent(sellerId)}/temporary-credential`,
    { method: 'POST', body: { sendWhatsapp: true } },
    env
  );
  const result = payload?.data || payload?.result || payload || {};
  const name = result.sellerName || sellerName(seller) || query;

  return {
    handled: true,
    reply: `✅ Credencial temporal enviada a ${name} por WhatsApp. Al iniciar sesión deberá crear su contraseña personal.`,
    execution: payload,
    tool: 'enviar_credencial_temporal_vendedor'
  };
};

module.exports = { detectSellerTemporaryCredential, detectSellerAuditByPhone, detectSellerNameEdit, formatSellerAudit };
