'use strict';

const commandService = require('./elanUnifiedOwnerCommandService');
const connect = require('./ownerBusinessConnectClient');

const originalDetect = commandService.detectOwnerUnifiedCommand;
const originalExecute = commandService.executeOwnerUnifiedCommand;

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
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

function unwrapSellerList(payload) {
  const data = payload?.data ?? payload?.result?.data ?? payload?.result ?? payload;
  return Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
}

commandService.detectOwnerUnifiedCommand = function patchedDetectOwnerUnifiedCommand(message) {
  return detectSellerTemporaryCredential(message) || originalDetect(message);
};

commandService.executeOwnerUnifiedCommand = async function patchedExecuteOwnerUnifiedCommand(options = {}) {
  const command = options.command;
  if (!command?.temporarySellerCredential) return originalExecute(options);
  if (command.invalid) return { handled: true, reply: command.invalid, execution: null, tool: null };

  const query = String(command.sellerQuery || '').trim();
  const searchPayload = await connect.listOwnerSellers(query, options.env || process.env);
  const sellers = unwrapSellerList(searchPayload);
  if (!sellers.length) {
    return { handled: true, reply: `No encontré al vendedor “${query}” en CONNECT.`, execution: searchPayload, tool: 'buscar_vendedor' };
  }
  if (sellers.length > 1) {
    const names = sellers.slice(0, 10).map((seller) => seller.displayName || seller.name || seller.id).join('; ');
    return { handled: true, reply: `Encontré varias coincidencias: ${names}. Decime cuál vendedor querés usar.`, execution: searchPayload, tool: 'buscar_vendedor' };
  }

  const seller = sellers[0];
  const sellerId = String(seller.id || seller.sellerId || '').trim();
  if (!sellerId) throw Object.assign(new Error('CONNECT no devolvió el identificador del vendedor.'), { code: 'SELLER_ID_MISSING', statusCode: 502 });

  const payload = await connect.requestConnect(
    `/api/v1/business/vqs/owner-directory/sellers/${encodeURIComponent(sellerId)}/temporary-credential`,
    { method: 'POST', body: { sendWhatsapp: true } },
    options.env || process.env
  );
  const result = payload?.data || payload?.result || payload || {};
  const name = result.sellerName || seller.displayName || seller.name || query;

  return {
    handled: true,
    reply: `✅ Credencial temporal enviada a ${name} por WhatsApp. Al iniciar sesión deberá crear su contraseña personal.`,
    execution: payload,
    tool: 'enviar_credencial_temporal_vendedor'
  };
};

module.exports = { detectSellerTemporaryCredential };
