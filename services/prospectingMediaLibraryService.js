'use strict';

const { createHmac } = require('node:crypto');
const {
  getWahaConfig,
  isAuthorizedWahaHost,
  normalizeMimeType,
  resolveMediaUrl
} = require('./connectVoiceService');

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const LIBRARY_CAPTURE_TTL_MS = Number(process.env.OWNER_LIBRARY_CAPTURE_TTL_MS || 15 * 60 * 1000);
const libraryCaptureSessions = new Map();
const pendingOwnerMedia = new Map();
const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg','image/png','image/webp','image/gif',
  'video/mp4','video/webm','video/quicktime'
]);

const FOLDER_LABELS = {
  rotulos_fachadas: 'Rótulos y fachadas',
  senalizacion: 'Señalización',
  letras_corporeas: 'Letras corpóreas',
  cajas_luz: 'Cajas de luz',
  viniles: 'Viniles',
  acrilico_pvc: 'Acrílico / PVC',
  material_pop: 'Material POP',
  impresion_gran_formato: 'Impresión gran formato',
  interiores: 'Interiores',
  vehiculos: 'Vehículos',
  proyectos_multisucursal: 'Proyectos multisucursal',
  antes_despues: 'Antes / después',
  muestras_trabajo: 'Muestras de trabajo',
  presentaciones_corporativas: 'Presentaciones corporativas',
  otros: 'Otros'
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isLibraryMediaSaveRequest(text) {
  const value = normalizeText(text);
  if (!value) return false;

  const diagnosticOrControlIntent =
    /\b(log|logs|error|errores|estado|status|salud|health|supervisor|deploy|despliegue|commit|rama|branch|servicio|systemctl|journal|solo lectura|read only|no reinicies|no despliegues|no toques|audita|auditar|revisa|revisar|diagnostica|diagnosticar|muestra|muestrame|mostrar)\b/.test(value);

  if (diagnosticOrControlIntent) return false;

  const action = /\b(carga|cargar|cargalo|cargala|guarda|guardar|guardalo|guardala|agrega|agregar|agregalo|agregala|sube|subir|archiva|archivar|pasare|pasarte|mandare|mandarte|enviare|enviarte)\b/.test(value);
  const destination = /\b(biblioteca|recursos|recurso|muestras|portafolio)\b/.test(value);
  return action && destination;
}

function isLibraryCaptureStopRequest(text) {
  const value = normalizeText(text);
  if (!value) return false;
  return /\b(terminamos|termine|terminado|cerrar|salir|deten|detener|parar|ya no)\b/.test(value) &&
    /\b(biblioteca|carga|cargar|imagenes|fotos|videos|recursos)\b/.test(value);
}

function ownerLibraryKey(incoming = {}) {
  return [
    String(incoming.session || 'ELANKAV'),
    String(incoming.chatId || incoming.senderRaw || incoming.phone || 'owner')
  ].join(':');
}

function pruneOwnerLibraryState(now = Date.now()) {
  for (const [key, value] of libraryCaptureSessions.entries()) {
    if (!value || value.expiresAt <= now) libraryCaptureSessions.delete(key);
  }
  for (const [key, value] of pendingOwnerMedia.entries()) {
    if (!value || value.expiresAt <= now) pendingOwnerMedia.delete(key);
  }
}

function enableLibraryCapture(incoming, contextText = '') {
  pruneOwnerLibraryState();
  const key = ownerLibraryKey(incoming);
  libraryCaptureSessions.set(key, {
    contextText: String(contextText || '').trim(),
    expiresAt: Date.now() + LIBRARY_CAPTURE_TTL_MS
  });
  return { key, active: true };
}

function disableLibraryCapture(incoming) {
  const key = ownerLibraryKey(incoming);
  libraryCaptureSessions.delete(key);
  pendingOwnerMedia.delete(key);
  return { key, active: false };
}

function clearOwnerLibraryState() {
  libraryCaptureSessions.clear();
  pendingOwnerMedia.clear();
}

function getLibraryCapture(incoming) {
  pruneOwnerLibraryState();
  return libraryCaptureSessions.get(ownerLibraryKey(incoming)) || null;
}

function isLibraryCaptureActive(incoming) {
  return Boolean(getLibraryCapture(incoming));
}

function rememberPendingOwnerMedia(incoming) {
  if (!incoming?.media?.url || !['image', 'video'].includes(incoming.messageType)) return null;
  pruneOwnerLibraryState();
  const key = ownerLibraryKey(incoming);
  const remembered = {
    incoming: {
      ...incoming,
      media: { ...(incoming.media || {}) }
    },
    expiresAt: Date.now() + LIBRARY_CAPTURE_TTL_MS
  };
  pendingOwnerMedia.set(key, remembered);
  return remembered.incoming;
}

function peekPendingOwnerMedia(incoming) {
  pruneOwnerLibraryState();
  return pendingOwnerMedia.get(ownerLibraryKey(incoming))?.incoming || null;
}

function consumePendingOwnerMedia(incoming) {
  const key = ownerLibraryKey(incoming);
  const value = peekPendingOwnerMedia(incoming);
  if (value) pendingOwnerMedia.delete(key);
  return value;
}

function composeLibraryInstruction(incoming, extraText = '') {
  const capture = getLibraryCapture(incoming);
  return [
    'Guardar en biblioteca.',
    capture?.contextText || '',
    incoming?.text || '',
    extraText || ''
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function classifyFolder(text) {
  const n = normalizeText(text);
  const rules = [
    ['antes_despues', /\b(antes y despues|antes despues|transformacion|before after)\b/],
    ['proyectos_multisucursal', /\b(multisucursal|sucursales|cadena|franquicia)\b/],
    ['cajas_luz', /\b(caja de luz|cajas de luz|lightbox|luminoso|luminosos)\b/],
    ['vehiculos', /\b(vehiculo|vehiculos|vehicular|camion|camiones|carro|carros|flota)\b/],
    ['senalizacion', /\b(senalizacion|senaletica|senal|senales|directorio|directorios)\b/],
    ['material_pop', /\b(material pop|pop|display|displays|exhibidor|exhibidores)\b/],
    ['impresion_gran_formato', /\b(gran formato|impresion|banner|banners|lona|lonas)\b/],
    ['interiores', /\b(interior|interiores|recepcion|pared|paredes|oficina)\b/],
    ['viniles', /\b(vinil|viniles|microperforado|frost|polarizado|adhesivo)\b/],
    ['rotulos_fachadas', /\b(fachada|fachadas|rotulo|rotulos|letrero|letreros|exterior)\b/],
    ['letras_corporeas', /\b(letras corporeas|letra corporea|letras 3d|letra 3d)\b/],
    ['acrilico_pvc', /\b(acrilico|acrilicos|pvc)\b/],
    ['presentaciones_corporativas', /\b(presentacion|presentaciones|corporativa|corporativas|brochure)\b/],
    ['muestras_trabajo', /\b(muestra|muestras|portafolio|trabajo terminado|trabajos)\b/]
  ];
  const match = rules.find(([, regex]) => regex.test(n));
  return match ? match[0] : 'otros';
}

const TAG_RULES = [
  ['fachada', /\bfachadas?\b/],
  ['rotulacion', /\b(rotulo|rotulos|rotulacion|letrero|letreros)\b/],
  ['acm', /\bacm\b|aluminio compuesto/],
  ['pvc', /\bpvc\b/],
  ['acrilico', /\bacrilicos?\b/],
  ['led', /\bled\b/],
  ['iluminado', /\b(iluminado|iluminada|iluminacion|luminoso|luminosa)\b/],
  ['letras', /\bletras?\b/],
  ['corporeas', /\bcorporeas?\b|\b3d\b/],
  ['caja_luz', /\bcajas? de luz\b|lightbox/],
  ['vinil', /\bviniles?\b/],
  ['microperforado', /\bmicroperforado\b/],
  ['senalizacion', /\b(senalizacion|senaletica|senal|senales)\b/],
  ['estructura', /\b(estructura|estructuras)\b/],
  ['metal', /\b(metal|metalica|metalico|acero|hierro)\b/],
  ['lona', /\blonas?\b/],
  ['impresion', /\bimpresion\b/],
  ['material_pop', /\bmaterial pop\b|\bpop\b/],
  ['vehicular', /\b(vehicular|vehiculo|vehiculos|flota)\b/],
  ['exterior', /\b(exterior|fachada)\b/],
  ['interior', /\b(interior|interiores)\b/],
  ['premium', /\bpremium\b/],
  ['terminado', /\b(terminado|finalizado|final)\b/],
  ['montaje', /\b(montaje|instalacion|instalado|instalada)\b/]
];

function classifyTags(text, mediaKind) {
  const n = normalizeText(text);
  const tags = TAG_RULES.filter(([, regex]) => regex.test(n)).map(([tag]) => tag);
  tags.push(mediaKind);
  return [...new Set(tags)].slice(0, 30);
}

function titleFromInstruction(text, folder, mediaKind) {
  const stripped = String(text || '')
    .replace(/\b(carga|cargar|cargalo|cargala|guarda|guardar|guardalo|guardala|agrega|agregar|agregalo|agregala|sube|subir|archiva|archivar)\b/ig, '')
    .replace(/\b(esta|este|estas|estos|imagen|foto|video|archivo|a|al|la|el|en|biblioteca|recursos|recurso|muestras|portafolio)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,.:;\- ]+|[,.:;\- ]+$/g, '')
    .trim();
  const fallback = `${mediaKind === 'video' ? 'Video' : 'Foto'} · ${FOLDER_LABELS[folder] || 'Muestra de trabajo'}`;
  const title = stripped || fallback;
  return title.charAt(0).toUpperCase() + title.slice(1, 160);
}

function safeFileName(value, mediaKind) {
  const fallback = mediaKind === 'video' ? 'whatsapp-video.mp4' : 'whatsapp-image.jpg';
  return String(value || fallback)
    .split(/[\\/]/)
    .pop()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || fallback;
}

function createError(code, status, message) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function connectBaseUrl() {
  return String(
    process.env.ELANKAV_CONNECT_URL ||
    process.env.CONNECT_API_URL ||
    DEFAULT_CONNECT_URL
  ).trim().replace(/\/+$/, '');
}

function connectInternalToken() {
  const explicit = String(
    process.env.CONNECT_INTERNAL_API_TOKEN ||
    process.env.CONNECT_INTERNAL_TOKEN ||
    process.env.ELANKAV_CONNECT_INTERNAL_TOKEN ||
    ''
  ).trim();
  if (explicit) return explicit;
  const root = String(process.env.VQS_API_TOKEN || '').trim();
  if (!root) return '';
  return createHmac('sha256', root)
    .update('ELANKAV_CHANNEL_INTERNAL_V1')
    .digest('hex');
}

async function downloadMedia({ url, webhookMimeType, fetchImpl = fetch }) {
  const { baseUrl, internalBaseUrl, apiKey } = getWahaConfig();
  const authorized = [baseUrl, internalBaseUrl].filter(Boolean);
  const primaryUrl = resolveMediaUrl(url, baseUrl);
  const primary = new URL(primaryUrl);
  if (!isAuthorizedWahaHost(primaryUrl, authorized)) {
    throw createError('WAHA_MEDIA_HOST_NOT_ALLOWED', 400, 'El recurso multimedia no pertenece a un host WAHA autorizado.');
  }

  async function once(targetUrl) {
    if (!isAuthorizedWahaHost(targetUrl, authorized)) {
      throw createError('WAHA_MEDIA_HOST_NOT_ALLOWED', 400, 'El recurso multimedia no pertenece a un host WAHA autorizado.');
    }
    const headers = { Accept: 'image/*,video/*,application/octet-stream' };
    if (apiKey && isAuthorizedWahaHost(targetUrl, authorized)) headers['X-Api-Key'] = apiKey;
    const response = await fetchImpl(targetUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(Number(process.env.WAHA_MEDIA_TIMEOUT_MS || 45_000))
    });
    if (!response.ok) throw createError('WAHA_MEDIA_DOWNLOAD_FAILED', response.status, `WAHA media HTTP ${response.status}`);
    const announced = Number(response.headers.get('content-length') || 0);
    if (announced > MAX_MEDIA_BYTES) throw createError('WAHA_MEDIA_TOO_LARGE', 413);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw createError('WAHA_MEDIA_EMPTY', 422);
    if (buffer.length > MAX_MEDIA_BYTES) throw createError('WAHA_MEDIA_TOO_LARGE', 413);
    const downloadedMime = normalizeMimeType(response.headers.get('content-type'));
    const webhookMime = normalizeMimeType(webhookMimeType);
    const mimeType = ALLOWED_MEDIA_TYPES.has(downloadedMime) ? downloadedMime : webhookMime;
    if (!ALLOWED_MEDIA_TYPES.has(mimeType)) throw createError('WAHA_MEDIA_TYPE_NOT_ALLOWED', 415);
    return { buffer, mimeType };
  }

  try {
    return await once(primaryUrl);
  } catch (error) {
    if (error?.status && error.status < 500) throw error;
    if (!internalBaseUrl) throw error;
    const fallbackUrl = resolveMediaUrl(`${primary.pathname}${primary.search}`, internalBaseUrl);
    if (fallbackUrl === primaryUrl) throw error;
    return once(fallbackUrl);
  }
}

async function uploadToConnect({ media, folder, title, description, tags, fileName, fetchImpl = fetch }) {
  const token = connectInternalToken();
  if (!token) throw createError('CONNECT_INTERNAL_TOKEN_REQUIRED', 503);
  const params = new URLSearchParams({
    folder,
    title,
    name: fileName,
    tags: tags.join(','),
    description: description || '',
    featured: 'false'
  });
  const response = await fetchImpl(
    `${connectBaseUrl()}/api/v1/prospecting/media-library/upload?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': media.mimeType
      },
      body: media.buffer,
      signal: AbortSignal.timeout(Number(process.env.CONNECT_MEDIA_UPLOAD_TIMEOUT_MS || 60_000))
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createError(
      payload?.error?.code || 'CONNECT_MEDIA_UPLOAD_FAILED',
      response.status,
      payload?.error?.message || `CONNECT media HTTP ${response.status}`
    );
  }
  return payload;
}

async function saveOwnerWhatsappMedia({ incoming, fetchImpl = fetch }) {
  if (!incoming?.media?.url) throw createError('WAHA_MEDIA_URL_REQUIRED', 400);
  const requestedMime = normalizeMimeType(incoming.media.mimeType);
  const mediaKind = requestedMime.startsWith('video/') || incoming.messageType === 'video' ? 'video' : 'image';
  const folder = classifyFolder(incoming.text);
  const tags = classifyTags(incoming.text, mediaKind);
  const title = titleFromInstruction(incoming.text, folder, mediaKind);
  const fileName = safeFileName(incoming.media.filename, mediaKind);
  const media = await downloadMedia({
    url: incoming.media.url,
    webhookMimeType: incoming.media.mimeType,
    fetchImpl
  });
  const actualKind = media.mimeType.startsWith('video/') ? 'video' : 'image';
  const finalTags = classifyTags(incoming.text, actualKind);
  const item = await uploadToConnect({
    media,
    folder,
    title,
    description: String(incoming.text || '').trim(),
    tags: finalTags,
    fileName,
    fetchImpl
  });
  return {
    item,
    folder,
    folderLabel: FOLDER_LABELS[folder] || folder,
    tags: finalTags,
    mediaKind: actualKind
  };
}

function librarySavedReply(result) {
  const kind = result.mediaKind === 'video' ? 'Video' : 'Foto';
  const tags = result.tags.length ? ` · etiquetas: ${result.tags.join(', ')}` : '';
  return `✅ ${kind} guardado en Biblioteca multimedia → ${result.folderLabel}${tags}.`;
}

module.exports = {
  ALLOWED_MEDIA_TYPES,
  FOLDER_LABELS,
  MAX_MEDIA_BYTES,
  LIBRARY_CAPTURE_TTL_MS,
  classifyFolder,
  classifyTags,
  clearOwnerLibraryState,
  composeLibraryInstruction,
  consumePendingOwnerMedia,
  disableLibraryCapture,
  enableLibraryCapture,
  getLibraryCapture,
  isLibraryCaptureActive,
  isLibraryCaptureStopRequest,
  isLibraryMediaSaveRequest,
  librarySavedReply,
  peekPendingOwnerMedia,
  rememberPendingOwnerMedia,
  saveOwnerWhatsappMedia,
  titleFromInstruction,
  uploadToConnect
};
