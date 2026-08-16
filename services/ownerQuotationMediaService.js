'use strict';

const { readContext, updateContext } = require('./ownerBusinessContextService');
const { downloadWahaMedia } = require('./connectVoiceService');
const {
  getQuotation,
  removeQuotationImage,
  uploadQuotationImage
} = require('./ownerBusinessConnectClient');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PENDING_TTL_MS = 15 * 60 * 1000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const pendingMedia = new Map();

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function conversationKey({ externalUserId, phone }) {
  return String(externalUserId || phone || 'owner').trim();
}

function cleanPending(now = Date.now()) {
  for (const [key, value] of pendingMedia.entries()) {
    if (!value?.expiresAt || value.expiresAt <= now) pendingMedia.delete(key);
  }
}

function savePendingMedia(identity, media, now = Date.now()) {
  cleanPending(now);
  const key = conversationKey(identity);
  pendingMedia.set(key, {
    url: String(media?.url || '').trim(),
    mimeType: String(media?.mimeType || media?.mimetype || '').trim(),
    filename: String(media?.filename || 'imagen').trim(),
    expiresAt: now + PENDING_TTL_MS
  });
}

function readPendingMedia(identity, now = Date.now()) {
  cleanPending(now);
  return pendingMedia.get(conversationKey(identity)) || null;
}

function clearPendingMedia(identity) {
  pendingMedia.delete(conversationKey(identity));
}

function mediaIntent(message, { hasMediaContext = false } = {}) {
  const text = normalize(message).replace(/^elan[\s,;:]+/, '');
  const hasImageWord = /\b(imagen|foto|fotografia|fotografía)\b/.test(text);
  const referencesCurrentMedia = hasMediaContext && /\b(esta|esta imagen|esta foto|la imagen|la foto)\b/.test(text);
  const remove = /\b(quita|quita la|elimina|borra|remueve|saca)\b/.test(text) && hasImageWord;
  if (remove) return { action: 'remove' };

  // Do not treat generic commercial commands like “agregá a esta cotización un rótulo”
  // as image operations. Image routing requires an explicit image/foto reference, or a
  // pronoun that refers to an actual pending/incoming media object.
  const attachVerb = /\b(agrega|agregala|agregá|pone|ponela|poné|anade|añade|adjunta|adjuntala|usa|usala|cambia|cambiala|reemplaza|reemplazala)\b/.test(text);
  if (attachVerb && (hasImageWord || referencesCurrentMedia)) {
    const mode = /\b(agrega|agregala|agregá|anade|añade|adjunta|adjuntala)\b/.test(text) ? 'add' : 'replace';
    return { action: 'attach', mode };
  }
  return null;
}

function imageMedia(metadata = {}) {
  const media = metadata?.media && typeof metadata.media === 'object' ? metadata.media : null;
  const mimeType = String(media?.mimeType || media?.mimetype || '').split(';')[0].trim().toLowerCase();
  const messageType = String(metadata?.messageType || '').toLowerCase();
  if (!media?.url) return null;
  if (messageType !== 'image' && !mimeType.startsWith('image/')) return null;
  return {
    url: String(media.url).trim(),
    mimeType,
    filename: String(media.filename || 'imagen').trim()
  };
}

function safeWahaUrl(rawUrl) {
  const publicBase = String(process.env.WAHA_BASE_URL || 'https://waha.elankav.com').replace(/\/+$/, '');
  const internalBase = String(process.env.WAHA_INTERNAL_BASE_URL || publicBase).replace(/\/+$/, '');
  const target = new URL(String(rawUrl || ''), `${publicBase}/`);
  const allowedHosts = new Set([new URL(publicBase).host, new URL(internalBase).host]);
  if (!allowedHosts.has(target.host)) {
    const error = new Error('WAHA_MEDIA_HOST_NOT_ALLOWED');
    error.code = 'WAHA_MEDIA_HOST_NOT_ALLOWED';
    throw error;
  }
  return target.toString();
}

async function downloadImage(media, fetchImpl = fetch) {
  const downloaded = await downloadWahaMedia({ url: media.url, fetchImpl });
  const downloadedType = String(downloaded?.mimeType || '').split(';')[0].trim().toLowerCase();
  const webhookType = String(media?.mimeType || '').split(';')[0].trim().toLowerCase();
  const contentType = (!downloadedType || downloadedType === 'application/octet-stream' || downloadedType === 'binary/octet-stream')
    ? webhookType
    : downloadedType;

  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    const error = new Error('Formato de imagen no permitido. Usá JPG, PNG o WEBP.');
    error.code = 'UNSUPPORTED_IMAGE_TYPE';
    error.statusCode = 415;
    throw error;
  }

  const buffer = Buffer.from(downloaded?.buffer || []);
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error(buffer.length ? 'La imagen supera 8 MB.' : 'La imagen recibida está vacía.');
    error.code = buffer.length ? 'IMAGE_TOO_LARGE' : 'IMAGE_EMPTY';
    error.statusCode = buffer.length ? 413 : 422;
    throw error;
  }

  return { buffer, mimeType: contentType };
}

function quoteNumber(record, context) {
  return String(record?.quotationNumber || context?.activeQuotationNumber || context?.activeQuotationId || '').trim();
}

async function processOwnerQuotationMediaMessage({ message, metadata = {}, externalUserId, phone, fetchImpl = fetch }) {
  const identity = { externalUserId, phone };
  const incomingImage = imageMedia(metadata);
  const pending = readPendingMedia(identity);
  const intent = mediaIntent(message, { hasMediaContext: Boolean(incomingImage || pending) });

  if (incomingImage && !intent) {
    savePendingMedia(identity, incomingImage);
    return {
      handled: true,
      outputText: '✅ Imagen recibida. Decime “ELAN agregá esta imagen a la cotización” y la colocaré en la cotización activa.',
      status: 'image_pending'
    };
  }

  if (!intent) return { handled: false };

  const context = await readContext();
  if (!context.activeProjectId || !context.activeQuotationId) {
    if (incomingImage) savePendingMedia(identity, incomingImage);
    return {
      handled: true,
      outputText: 'No tengo una cotización activa para modificar. Primero buscá o creá la cotización y luego decime que agregue la imagen.',
      status: 'quotation_required'
    };
  }

  if (intent.action === 'remove') {
    const result = await removeQuotationImage(context.activeProjectId, {});
    const data = result?.data || result || {};
    clearPendingMedia(identity);
    return {
      handled: true,
      outputText: [
        '✅ Imagen quitada de la cotización activa.',
        `Cotización: ${data.quotationNumber || context.activeQuotationNumber || context.activeQuotationId}`,
        data.publicUrl ? `Enlace: ${data.publicUrl}` : ''
      ].filter(Boolean).join('\n'),
      status: 'completed',
      result: data
    };
  }

  const media = incomingImage || pending;
  if (!media) {
    return {
      handled: true,
      outputText: 'Enviame primero la imagen por WhatsApp y después decime “ELAN agregá esta imagen a la cotización”.',
      status: 'image_required'
    };
  }

  try {
    const currentResponse = await getQuotation(context.activeProjectId);
    const current = currentResponse?.data || currentResponse || {};
    if (String(current.status || '').toLowerCase() !== 'draft') {
      return {
        handled: true,
        outputText: `La cotización ${quoteNumber(current, context)} ya no está en borrador. No cambiaré su imagen sin un flujo de revisión.`,
        status: 'blocked'
      };
    }

    const downloaded = await downloadImage(media, fetchImpl);
    const uploadedResponse = await uploadQuotationImage(context.activeProjectId, {
      imageBase64: downloaded.buffer.toString('base64'),
      mimeType: downloaded.mimeType,
      filename: media.filename || 'imagen',
      mode: intent.mode || 'replace'
    });
    const data = uploadedResponse?.data || uploadedResponse || {};
    clearPendingMedia(identity);
    await updateContext({
      activeQuotationId: data.quotationId || context.activeQuotationId,
      activeQuotationNumber: data.quotationNumber || context.activeQuotationNumber,
      activeQuotationPublicUrl: data.publicUrl || context.activeQuotationPublicUrl,
      activeProjectId: data.projectId || context.activeProjectId,
      lastEntityType: 'quotation',
      lastEntityId: data.quotationId || context.activeQuotationId
    });

    return {
      handled: true,
      outputText: [
        '✅ Imagen agregada a la cotización activa.',
        `Cotización: ${data.quotationNumber || context.activeQuotationNumber || context.activeQuotationId}`,
        data.publicUrl ? `Enlace: ${data.publicUrl}` : '',
        'La misma cotización fue actualizada; no se creó ningún duplicado.'
      ].filter(Boolean).join('\n'),
      status: 'completed',
      result: data
    };
  } catch (error) {
    const code = error?.code || 'QUOTATION_IMAGE_FAILED';
    if (code === 'QUOTATION_ITEM_AMBIGUOUS') {
      return {
        handled: true,
        outputText: 'La cotización tiene varios productos. Indicame a cuál ítem querés agregar la imagen para no modificar el equivocado.',
        status: 'clarification_required'
      };
    }
    return {
      handled: true,
      outputText: [
        'No pude agregar la imagen a la cotización.',
        `Error: ${code}`,
        error?.message ? `Detalle: ${error.message}` : '',
        'La cotización no fue duplicada.'
      ].filter(Boolean).join('\n'),
      status: 'failed'
    };
  }
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  clearPendingMedia,
  downloadImage,
  imageMedia,
  mediaIntent,
  processOwnerQuotationMediaMessage,
  readPendingMedia,
  savePendingMedia,
  safeWahaUrl
};
