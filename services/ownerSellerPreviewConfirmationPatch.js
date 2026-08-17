'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const commandService = require('./elanUnifiedOwnerCommandService');
const connect = require('./ownerBusinessConnectClient');

const previousDetect = commandService.detectOwnerUnifiedCommand;
const previousExecute = commandService.executeOwnerUnifiedCommand;
const TTL_MS = 30 * 60 * 1000;

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function digits(value) { return String(value || '').replace(/\D/g, ''); }
function sellerName(seller) { return String(seller?.displayName || seller?.name || seller?.legalName || seller?.id || '').trim(); }
function unwrapSellerList(payload) {
  const data = payload?.data ?? payload?.result?.data ?? payload?.result ?? payload;
  return Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
}
function actorKey(actor = {}) { return String(actor.phone || actor.canonicalPhone || actor.actorId || actor.id || 'owner').trim() || 'owner'; }
function storePath(env = process.env) { return String(env.OWNER_SELLER_PREVIEW_STORE_PATH || '/tmp/elankav-owner-seller-previews.json').trim(); }
function readStore(env = process.env) {
  const file = storePath(env);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function writeStore(store, env = process.env) {
  const file = storePath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function prune(store) {
  const now = Date.now();
  for (const [code, record] of Object.entries(store)) {
    if (!record || Number(record.expiresAt || 0) <= now) delete store[code];
  }
  return store;
}
function previewCode() { return `SELLER-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`; }
function putPending(record, env) {
  const store = prune(readStore(env));
  const code = previewCode();
  store[code] = { ...record, code, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS };
  writeStore(store, env);
  return store[code];
}
function getPending(code, actor, env) {
  const store = prune(readStore(env));
  writeStore(store, env);
  const record = store[String(code || '').toUpperCase()];
  if (!record || record.actorKey !== actorKey(actor)) return null;
  return record;
}
function removePending(code, env) {
  const store = prune(readStore(env));
  delete store[String(code || '').toUpperCase()];
  writeStore(store, env);
}
function updatePending(code, actor, patch, env) {
  const store = prune(readStore(env));
  const key = String(code || '').toUpperCase();
  const record = store[key];
  if (!record || record.actorKey !== actorKey(actor)) return null;
  store[key] = { ...record, ...patch, expiresAt: Date.now() + TTL_MS };
  writeStore(store, env);
  return store[key];
}

function phoneFromMessage(raw) {
  const match = String(raw || '').match(/(?:whatsapp|wasap|telefono|teléfono|celular|n[uú]mero(?:\s+de\s+whatsapp)?)\s*(?:es|:|=)?\s*(\+?[\d\s-]{8,})/i);
  return String(match?.[1] || '').trim();
}
function newNameFromMessage(raw) {
  const match = String(raw || '').match(/(?:cambia|cambiar|cambiale|actualiza|actualizar|edita|editar|modifica|modificar)?\s*(?:el\s+)?nombre\s+(?:a|por|es)?\s*[:=]?\s*(.+?)(?=\r?\n|\s+(?:y\s+)?(?:manten[eé]|deja|conserva|whatsapp|wasap|telefono|teléfono|celular|correo|email|zona)\b|$)/i);
  return String(match?.[1] || '').trim().replace(/[.!]+$/, '').trim();
}
function targetNameFromMessage(raw) {
  const match = String(raw || '').match(/\b(?:vendedor|vendedora)\b\s+(?:cuyo\s+[^\n]*?nombre\s+(?:actual\s+)?(?:aparece\s+como)?\s*[:=]?\s*)?(.+?)(?=\s+(?:cuyo|con\s+whatsapp|whatsapp|wasap|telefono|teléfono|celular|cambia|cambiar|edita|editar|actualiza|actualizar|modifica|modificar|no\s+elimines)\b|\r?\n|$)/i);
  const value = String(match?.[1] || '').trim().replace(/[.!]+$/, '').trim();
  return /^(cuyo|con)$/i.test(value) ? '' : value;
}
function correctionFields(raw) {
  const text = String(raw || '');
  const data = {};
  const name = text.match(/(?:nombre|name)\s*[:=]\s*([^\n,;]+)/i)?.[1]?.trim();
  const whatsapp = text.match(/(?:whatsapp|wasap)\s*[:=]\s*(\+?[\d\s-]{8,})/i)?.[1]?.trim();
  const phone = text.match(/(?:telefono|teléfono|celular)\s*[:=]\s*(\+?[\d\s-]{8,})/i)?.[1]?.trim();
  const email = text.match(/(?:correo|email)\s*[:=]\s*([^\s,;]+@[^\s,;]+)/i)?.[1]?.trim();
  const zone = text.match(/zona\s*[:=]\s*([^\n,;]+)/i)?.[1]?.trim();
  if (name) data.displayName = name;
  if (whatsapp) data.whatsapp = whatsapp;
  if (phone) data.phone = phone;
  if (email) data.email = email;
  if (zone) data.zone = zone;
  return data;
}
function findSellerMatches(sellers, query) {
  const queryDigits = digits(query);
  if (queryDigits.length >= 8) {
    return sellers.filter((seller) => [digits(seller?.whatsapp), digits(seller?.phone)].filter(Boolean).some((value) => value === queryDigits || value.endsWith(queryDigits) || queryDigits.endsWith(value)));
  }
  const needle = normalize(query);
  if (!needle) return [];
  return sellers.filter((seller) => normalize(sellerName(seller)) === needle || normalize(sellerName(seller)).includes(needle));
}
function formatSeller(seller) {
  return [
    `Nombre: ${sellerName(seller) || '—'}`,
    `WhatsApp: ${seller?.whatsapp || '—'}`,
    `Teléfono: ${seller?.phone || '—'}`,
    `Correo: ${seller?.email || '—'}`,
    `Código: ${seller?.sellerCode || seller?.seller_code || '—'}`,
    `Estado: ${seller?.status || '—'}`,
    `ID: ${seller?.id || seller?.sellerId || '—'}`
  ].join('\n');
}
function formatProposed(data = {}) {
  return [
    `Nombre: ${data.displayName || '—'}`,
    `WhatsApp: ${data.whatsapp || '—'}`,
    `Teléfono: ${data.phone || '—'}`,
    `Correo: ${data.email || '—'}`,
    `Zona: ${data.zone || '—'}`
  ].join('\n');
}
function previewReply(record) {
  const heading = record.action === 'create' ? '📋 PREVIO — CREAR VENDEDOR' : record.action === 'edit' ? '📋 PREVIO — EDITAR VENDEDOR' : record.action === 'delete' ? '⚠️ PREVIO — ELIMINAR VENDEDOR' : record.action === 'deactivate' ? '⚠️ PREVIO — DESACTIVAR VENDEDOR' : '🔐 PREVIO — CREDENCIAL TEMPORAL';
  const lines = [heading, ''];
  if (record.current) { lines.push('Registro encontrado en CONNECT:', formatSeller(record.current), ''); }
  if (record.action === 'create' || record.action === 'edit') lines.push(record.action === 'edit' ? 'Datos propuestos:' : 'Datos extraídos:', formatProposed(record.data || {}), '');
  if (record.action === 'credential') {
    lines.push(`Destino: ${record.current?.whatsapp || record.current?.phone || '—'}`, `Correo de acceso: ${record.current?.email || '—'}`, '');
    if (!record.current?.email) lines.push('⚠️ Falta correo. No se puede generar la credencial hasta corregirlo.', '');
  }
  lines.push('NO se hizo ningún cambio en CONNECT.', `Para ejecutar: CONFIRMAR ${record.code}`, `Para cancelar: CANCELAR ${record.code}`);
  if (record.action === 'create' || record.action === 'edit') lines.push(`Para corregir el previo: CORREGIR ${record.code} NOMBRE: ... WHATSAPP: ... CORREO: ...`);
  return lines.join('\n');
}

function detectControl(raw) {
  const text = String(raw || '').trim();
  let match = text.match(/^\s*CONFIRMAR\s+(SELLER-[A-Z0-9-]+)\s*$/i);
  if (match) return { sellerPreviewControl: 'confirm', code: match[1].toUpperCase(), tool: 'confirmar_previo_vendedor' };
  match = text.match(/^\s*CANCELAR\s+(SELLER-[A-Z0-9-]+)\s*$/i);
  if (match) return { sellerPreviewControl: 'cancel', code: match[1].toUpperCase(), tool: 'cancelar_previo_vendedor' };
  match = text.match(/^\s*CORREGIR\s+(SELLER-[A-Z0-9-]+)\s+([\s\S]+)$/i);
  if (match) return { sellerPreviewControl: 'correct', code: match[1].toUpperCase(), correction: match[2], tool: 'corregir_previo_vendedor' };
  return null;
}
function detectAudit(raw) {
  const text = normalize(raw);
  if (!/\b(vendedor|vendedora|vendedores|vendedoras)\b/.test(text)) return null;
  if (!/\b(busca|buscar|buscame|encontra|encuentra|mostra|mostrar|mostrame|muestrame|audita|auditar|datos|informacion)\b/.test(text)) return null;
  const phone = phoneFromMessage(raw);
  if (digits(phone).length < 8) return null;
  return { sellerReadOnlyAudit: true, query: phone, tool: 'buscar_vendedor' };
}

commandService.detectOwnerUnifiedCommand = function detectWithSellerPreview(message) {
  const raw = String(message || '').trim();
  const control = detectControl(raw);
  if (control) return control;
  const audit = detectAudit(raw);
  if (audit) return audit;

  const prior = previousDetect(raw);
  const text = normalize(raw);
  if (!/\b(vendedor|vendedora|vendedores|vendedoras)\b/.test(text)) return prior;

  if (prior?.temporarySellerCredential) return { sellerPreview: true, action: 'credential', query: prior.sellerQuery, tool: 'previsualizar_credencial_vendedor' };
  if (prior?.tool === 'crear_vendedor') return { sellerPreview: true, action: 'create', data: prior.arguments?.data || {}, tool: 'previsualizar_crear_vendedor' };

  if (/\b(elimina|eliminar|borra|borrar)\b/.test(text)) {
    return { sellerPreview: true, action: 'delete', query: phoneFromMessage(raw) || targetNameFromMessage(raw), tool: 'previsualizar_eliminar_vendedor' };
  }
  if (/\b(desactiva|desactivar)\b/.test(text)) {
    return { sellerPreview: true, action: 'deactivate', query: phoneFromMessage(raw) || targetNameFromMessage(raw), tool: 'previsualizar_desactivar_vendedor' };
  }
  if (/\b(edita|editar|actualiza|actualizar|cambia|cambiar|modifica|modificar)\b/.test(text)) {
    const data = { ...(prior?.arguments?.data || {}) };
    const newName = newNameFromMessage(raw);
    if (newName) data.displayName = newName;
    const explicitPhone = phoneFromMessage(raw);
    return { sellerPreview: true, action: 'edit', query: explicitPhone || prior?.resolve?.query || targetNameFromMessage(raw), data, tool: 'previsualizar_editar_vendedor' };
  }
  return prior;
};

async function resolveOneSeller(query, env) {
  const payload = await connect.listOwnerSellers('', env);
  const sellers = unwrapSellerList(payload);
  const matches = findSellerMatches(sellers, query);
  return { payload, matches };
}

commandService.executeOwnerUnifiedCommand = async function executeWithSellerPreview(options = {}) {
  const command = options.command || {};
  const env = options.env || process.env;
  const actor = options.actor || {};

  if (command.sellerReadOnlyAudit) {
    const { payload, matches } = await resolveOneSeller(command.query, env);
    if (!matches.length) return { handled: true, reply: `No encontré un vendedor con ${command.query} en CONNECT.`, execution: payload, tool: 'buscar_vendedor' };
    if (matches.length > 1) return { handled: true, reply: `Encontré varias coincidencias: ${matches.slice(0, 10).map(sellerName).join('; ')}.`, execution: payload, tool: 'buscar_vendedor' };
    return { handled: true, reply: `🔎 VENDEDOR EN CONNECT\n\n${formatSeller(matches[0])}\n\nNo se hizo ningún cambio.`, execution: payload, tool: 'buscar_vendedor' };
  }

  if (command.sellerPreviewControl === 'cancel') {
    const pending = getPending(command.code, actor, env);
    if (!pending) return { handled: true, reply: 'Ese previo no existe, venció o pertenece a otra sesión. No se hizo ningún cambio.', execution: null, tool: command.tool };
    removePending(command.code, env);
    return { handled: true, reply: `✅ Previo ${command.code} cancelado. No se hizo ningún cambio en CONNECT.`, execution: null, tool: command.tool };
  }

  if (command.sellerPreviewControl === 'correct') {
    const pending = getPending(command.code, actor, env);
    if (!pending) return { handled: true, reply: 'Ese previo no existe, venció o pertenece a otra sesión. No se hizo ningún cambio.', execution: null, tool: command.tool };
    if (!['create', 'edit'].includes(pending.action)) return { handled: true, reply: 'Ese tipo de previo no admite corrección de campos. Cancelalo y prepará uno nuevo.', execution: null, tool: command.tool };
    const changes = correctionFields(command.correction);
    if (!Object.keys(changes).length) return { handled: true, reply: 'No pude identificar ningún dato para corregir. Usá, por ejemplo: NOMBRE: Juan Ruiz o WHATSAPP: +505...', execution: null, tool: command.tool };
    const updated = updatePending(command.code, actor, { data: { ...(pending.data || {}), ...changes } }, env);
    return { handled: true, reply: previewReply(updated), execution: null, tool: command.tool };
  }

  if (command.sellerPreviewControl === 'confirm') {
    const pending = getPending(command.code, actor, env);
    if (!pending) return { handled: true, reply: 'Ese previo no existe, venció o pertenece a otra sesión. No se hizo ningún cambio.', execution: null, tool: command.tool };
    let execution;
    if (pending.action === 'create') {
      execution = await connect.createOwnerSeller(pending.data || {}, env);
    } else if (pending.action === 'edit') {
      execution = await connect.updateOwnerSeller(pending.sellerId, pending.data || {}, env);
    } else if (pending.action === 'delete') {
      execution = await connect.deleteOwnerSeller(pending.sellerId, env);
    } else if (pending.action === 'deactivate') {
      execution = await connect.deactivateOwnerSeller(pending.sellerId, env);
    } else if (pending.action === 'credential') {
      if (!pending.current?.email) return { handled: true, reply: 'No ejecuté el envío: el vendedor no tiene correo registrado. Corregí primero el correo y generá un nuevo previo.', execution: null, tool: command.tool };
      execution = await connect.requestConnect(`/api/v1/business/vqs/owner-directory/sellers/${encodeURIComponent(pending.sellerId)}/temporary-credential`, { method: 'POST', body: { sendWhatsapp: true } }, env);
    } else {
      return previousExecute(options);
    }

    if (pending.action === 'delete') {
      const verification = await connect.listOwnerSellers('', env);
      const remains = unwrapSellerList(verification).some((seller) => String(seller.id || seller.sellerId || '') === String(pending.sellerId));
      if (remains) return { handled: true, reply: '⚠️ CONNECT respondió a la eliminación, pero el registro todavía aparece. No la marco como verificada.', execution, tool: command.tool };
      removePending(command.code, env);
      return { handled: true, reply: `✅ Eliminación verificada en CONNECT.\nVendedor: ${sellerName(pending.current)}\nID: ${pending.sellerId}`, execution, tool: command.tool };
    }

    if (pending.action === 'credential') {
      removePending(command.code, env);
      const result = execution?.data || execution?.result || execution || {};
      return { handled: true, reply: result.deliveredToWhatsApp ? `✅ Credencial temporal generada y enviada a ${sellerName(pending.current)}. Al ingresar deberá crear su contraseña personal.` : '⚠️ La credencial fue procesada, pero CONNECT no confirmó entrega por WhatsApp.', execution, tool: command.tool };
    }

    const verification = await connect.listOwnerSellers('', env);
    const sellerId = pending.sellerId || String(execution?.data?.id || execution?.result?.id || execution?.id || '');
    const verified = unwrapSellerList(verification).find((seller) => sellerId && String(seller.id || seller.sellerId || '') === String(sellerId)) || (pending.action === 'create' ? findSellerMatches(unwrapSellerList(verification), pending.data?.whatsapp || pending.data?.displayName || '')[0] : null);
    if (!verified) return { handled: true, reply: '⚠️ CONNECT respondió a la operación, pero no pude verificar el registro final. No la marco como cerrada.', execution, tool: command.tool };
    removePending(command.code, env);
    return { handled: true, reply: `✅ Cambio confirmado y verificado en CONNECT.\n\n${formatSeller(verified)}`, execution, tool: command.tool };
  }

  if (command.sellerPreview) {
    if (command.action === 'create') {
      const pending = putPending({ actorKey: actorKey(actor), action: 'create', data: command.data || {} }, env);
      return { handled: true, reply: previewReply(pending), execution: null, tool: command.tool };
    }
    const query = String(command.query || '').trim();
    if (!query) return { handled: true, reply: 'No pude identificar qué vendedor querés afectar. No se hizo ningún cambio.', execution: null, tool: command.tool };
    const { payload, matches } = await resolveOneSeller(query, env);
    if (!matches.length) return { handled: true, reply: `No encontré un vendedor que coincida con “${query}”. No se hizo ningún cambio.`, execution: payload, tool: 'buscar_vendedor' };
    if (matches.length > 1) return { handled: true, reply: `Encontré varias coincidencias: ${matches.slice(0, 10).map(sellerName).join('; ')}. No se hizo ningún cambio.`, execution: payload, tool: 'buscar_vendedor' };
    const seller = matches[0];
    const sellerId = String(seller.id || seller.sellerId || '').trim();
    const pending = putPending({ actorKey: actorKey(actor), action: command.action, sellerId, current: seller, data: command.data || {} }, env);
    return { handled: true, reply: previewReply(pending), execution: payload, tool: command.tool };
  }

  return previousExecute(options);
};

module.exports = { detectAudit, detectControl, findSellerMatches, phoneFromMessage, previewReply };
