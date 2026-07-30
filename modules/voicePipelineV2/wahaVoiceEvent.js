'use strict';

function normalizeMimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function normalizePhone(value) {
  const raw = String(value || '').split('@')[0].replace(/\D/g, '');
  if (!raw) return '';
  return raw.length === 8 ? `505${raw}` : raw;
}

function extractPayload(body = {}) {
  return body.payload && typeof body.payload === 'object' ? body.payload : body;
}

function extractMessageId(payload = {}, body = {}) {
  return String(
    body.id || body.eventId || body.messageId || payload.id?.id || payload.id ||
    payload.messageId || payload.key?.id || payload._data?.id?.id ||
    payload.message?.key?.id || ''
  ).trim();
}

function extractSender(payload = {}) {
  const candidates = [
    payload.from, payload.author, payload.participant, payload.sender, payload.chatId,
    payload.key?.remoteJid, payload.key?.participant, payload.id?.remote,
    payload.id?.participant, payload._data?.from, payload._data?.author,
    payload._data?.participant, payload._data?.id?.remote,
    payload._data?.id?.participant, payload.message?.key?.remoteJid,
    payload.message?.key?.participant
  ].filter(Boolean);
  return String(candidates.find(value => /@(c\.us|lid)$/.test(String(value))) || candidates[0] || '');
}

function rawMimeType(payload = {}) {
  const media = payload.media || payload._data?.media || null;
  return String(
    payload.mimetype || payload.mimeType || payload.message?.mimetype ||
    payload.message?.mimeType || payload.message?.audioMessage?.mimetype ||
    payload._data?.mimetype || payload._data?.mimeType ||
    (media && typeof media === 'object' ? media.mimetype || media.mimeType : '') || ''
  );
}

function extractMedia(payload = {}) {
  const media = payload.media || payload._data?.media || null;
  const url = String(
    payload.mediaUrl || payload.downloadUrl || payload.url || payload.message?.mediaUrl ||
    payload._data?.mediaUrl || (media && typeof media === 'object' ? media.url : '') || ''
  ).trim();
  const mimeType = normalizeMimeType(rawMimeType(payload) || 'audio/ogg');
  const filename = String(
    payload.filename || payload.message?.filename ||
    (media && typeof media === 'object' ? media.filename : '') || 'voice.ogg'
  );
  return { url, mimeType, filename };
}

function isVoicePayload(payload = {}) {
  const explicit = String(payload.type || payload.messageType || payload._data?.type || '').toLowerCase();
  if (['ptt', 'audio', 'voice'].includes(explicit)) return true;
  if (payload.message?.audioMessage) return true;
  return normalizeMimeType(rawMimeType(payload)).startsWith('audio/');
}

function normalizeWahaVoiceEvent(body = {}, env = process.env) {
  const payload = extractPayload(body);
  if (!isVoicePayload(payload)) return null;
  const senderRaw = extractSender(payload);
  const chatId = String(payload.from || payload.chatId || payload.key?.remoteJid || payload._data?.from || senderRaw || '');
  return {
    event: String(body.event || payload.event || '').toLowerCase(),
    messageId: extractMessageId(payload, body),
    session: String(body.session || payload.session || env.WAHA_SESSION || 'default'),
    senderRaw,
    chatId,
    phone: normalizePhone(senderRaw),
    media: extractMedia(payload),
    fromMe: Boolean(payload.fromMe ?? payload.key?.fromMe ?? payload.id?.fromMe ?? payload._data?.id?.fromMe ?? false),
    isGroup: chatId.includes('@g.us'),
    isBroadcast: chatId.includes('status@broadcast')
  };
}

module.exports = {
  extractMedia,
  isVoicePayload,
  normalizeMimeType,
  normalizePhone,
  normalizeWahaVoiceEvent
};