'use strict';

const {
  createDesignPortalSupabaseAdapter,
  SUPPORTED_DELIVERY_MIME_TYPES
} = require('../adapters/designPortalSupabaseAdapter');
const { fetchDesignAsset } = require('../adapters/designEngineAdapter');
const {
  buildDesignFollowupInstructions,
  buildDesignReadyCaption,
  createWahaDeliveryAdapter
} = require('../adapters/wahaDeliveryAdapter');
const { processDesignRequest } = require('./designEngineService');

const SUPPORTED_REFERENCE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);
const DELIVERY_URL_FIELDS = Object.freeze([
  'signedUrl',
  'publicUrl',
  'url',
  'downloadUrl',
  'imageUrl',
  'src'
]);

const state = {
  running: false,
  processed: 0,
  failed: 0,
  delivered: 0,
  deliveryFailed: 0,
  lastRunAt: null,
  lastRequestCode: null,
  lastErrorCode: null,
  lastDeliveryErrorCode: null
};

function sanitizeNotes(value) {
  return String(value || '')
    .replace(/(?:USD|NIO|C\$|U\$|\$)\s*\d+(?:[.,]\d+)?/gi, '')
    .trim();
}

function toInlineReference(file) {
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(file.mimeType)) return null;
  return Object.freeze({
    dataUrl: `data:${file.mimeType};base64,${file.buffer.toString('base64')}`,
    fileName: file.fileName
  });
}

function buildMeasurements(row) {
  const values = [];
  if (Number(row.width_cm) > 0) values.push({ name: 'ancho', value: Number(row.width_cm), unit: 'cm' });
  if (Number(row.height_cm) > 0) values.push({ name: 'alto', value: Number(row.height_cm), unit: 'cm' });
  return values;
}

function resultAssetId(response) {
  return response?.designResult?.assets?.[0]?.id || null;
}

function normalizeDeliveryMimeType(value = '') {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function isDeliverableDesignAsset(file = {}) {
  return SUPPORTED_DELIVERY_MIME_TYPES.has(normalizeDeliveryMimeType(file.mimeType));
}

function findDeliverableDesignAsset(row = {}) {
  const files = Array.isArray(row.result_files) ? row.result_files : [];
  return files.find(file => file?.kind === 'generated-render' && isDeliverableDesignAsset(file))
    || files.find(file => String(file?.kind || '').startsWith('generated-') && isDeliverableDesignAsset(file))
    || null;
}

function getAssetDeliveryUrl(asset = {}) {
  for (const field of DELIVERY_URL_FIELDS) {
    const value = asset[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getAssetFileName(asset = {}, row = {}) {
  const name = String(asset.name || '').trim();
  if (name) return name;
  const pathName = String(asset.path || '').split('/').filter(Boolean).pop();
  if (pathName) return pathName;
  const requestCode = String(row.request_code || 'design-render').trim() || 'design-render';
  return `${requestCode}.png`;
}

function getStoredImageDelivery(row = {}, asset = {}) {
  const delivery = row?.design_result?.delivery;
  if (!delivery || typeof delivery !== 'object') return null;
  if (delivery.status !== 'image_sent') return null;
  if (!delivery.chatId || !delivery.imageMessageId) return null;
  if (delivery.assetPath && asset.path && delivery.assetPath !== asset.path) return null;
  return delivery;
}

function deliveryAttempt(row = {}) {
  return Number(row.delivery_attempts || 0) + 1;
}

function createCodedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function ensureProcessed(response) {
  const assetId = resultAssetId(response);
  if (response?.processed !== true || !assetId) {
    const error = new Error('DESIGN_ENGINE_RESULT_NOT_READY');
    error.code = response?.designResult?.status === 'NEEDS_INFORMATION'
      ? 'DESIGN_ENGINE_NEEDS_INFORMATION'
      : 'DESIGN_ENGINE_RESULT_NOT_READY';
    throw error;
  }
  return assetId;
}

function buildCommonRequest(row, overrides = {}) {
  const measurements = buildMeasurements(row);
  const notes = sanitizeNotes(row.design_notes);
  return {
    requestId: overrides.requestId,
    identityId: row.external_user_id || row.whatsapp,
    phone: row.whatsapp,
    platform: 'ELANVISUAL',
    channel: 'design-portal',
    message: overrides.message || notes || `Crear propuesta para ${row.business_name}.`,
    projectType: overrides.projectType,
    environment: row.installation_environment || null,
    measurements,
    measurementStatus: measurements.length ? 'CONFIRMED' : 'MISSING',
    brandAssets: overrides.brandAssets || [],
    references: overrides.references || [],
    instructions: overrides.instructions || [],
    directClientConversation: false
  };
}

async function processClaimedRequest(row, dependencies = {}) {
  const adapter = dependencies.adapter;
  const generate = dependencies.processDesign || processDesignRequest;
  const fetchAsset = dependencies.fetchAsset || fetchDesignAsset;
  const downloaded = [];

  for (const file of Array.isArray(row.files) ? row.files : []) {
    downloaded.push(await adapter.downloadAsset(file));
  }

  const logoAssets = downloaded
    .filter(file => file.kind === 'logo')
    .map(toInlineReference)
    .filter(Boolean);
  const references = downloaded
    .filter(file => file.kind !== 'logo')
    .map(toInlineReference)
    .filter(Boolean);
  const generatedFiles = [];
  let finalResponse;

  if (row.needs_logo_design === true) {
    const logoResponse = await generate(buildCommonRequest(row, {
      requestId: `${row.request_code}-LOGO`,
      projectType: 'LOGO_DESIGN',
      message: `Crear un logotipo profesional original para ${row.business_name}. ${sanitizeNotes(row.design_notes)}`,
      references,
      brandAssets: []
    }));
    const logoAsset = await fetchAsset(ensureProcessed(logoResponse));
    const storedLogo = await adapter.uploadResult({
      requestCode: row.request_code,
      kind: 'generated-logo',
      asset: logoAsset
    });
    generatedFiles.push(storedLogo);

    if (row.request_type === 'logo') {
      finalResponse = logoResponse;
    } else {
      logoAssets.push(toInlineReference({
        ...logoAsset,
        fileName: 'generated-logo.png'
      }));
    }
  }

  if (row.request_type !== 'logo') {
    finalResponse = await generate(buildCommonRequest(row, {
      requestId: row.request_code,
      projectType: row.request_type === 'fachada'
        ? 'COMMERCIAL_FACADE_RENDER'
        : row.request_type === 'rotulo'
          ? 'COMMERCIAL_SIGN_RENDER'
          : 'CUSTOM_VISUAL_RENDER',
      brandAssets: logoAssets,
      references
    }));
    const renderAsset = await fetchAsset(ensureProcessed(finalResponse));
    const storedRender = await adapter.uploadResult({
      requestCode: row.request_code,
      kind: 'generated-render',
      asset: renderAsset
    });
    generatedFiles.unshift(storedRender);
  }

  return {
    resultFiles: generatedFiles,
    designResult: {
      designId: finalResponse?.designResult?.designId || null,
      status: finalResponse?.designResult?.status || null,
      provider: finalResponse?.provider || null,
      processed: finalResponse?.processed === true,
      stages: generatedFiles.map(file => file.kind)
    }
  };
}

async function deliverCompletedRequest(row, dependencies = {}) {
  const adapter = dependencies.adapter || createDesignPortalSupabaseAdapter();
  const delivery = dependencies.delivery || createWahaDeliveryAdapter();
  const attempts = deliveryAttempt(row);
  let asset = null;
  let resolvedAsset = null;
  let imageSent = null;

  try {
    if (typeof adapter.resolveDesignAsset !== 'function') {
      throw createCodedError('DESIGN_ASSET_RESOLVER_REQUIRED');
    }

    asset = findDeliverableDesignAsset(row);
    if (!asset) throw createCodedError('DESIGN_RENDER_ASSET_REQUIRED');

    const storedImageDelivery = getStoredImageDelivery(row, asset);
    if (storedImageDelivery) {
      imageSent = {
        chatId: storedImageDelivery.chatId,
        messageId: storedImageDelivery.imageMessageId,
        reused: true
      };
    } else {
      resolvedAsset = await adapter.resolveDesignAsset(asset);
      const imageUrl = getAssetDeliveryUrl(resolvedAsset);
      if (!imageUrl) throw createCodedError('DESIGN_ASSET_URL_REQUIRED');

      imageSent = await delivery.sendImage({
        phone: row.whatsapp,
        imageUrl,
        caption: buildDesignReadyCaption(row),
        fileName: getAssetFileName(resolvedAsset, row),
        mimeType: resolvedAsset.mimeType
      });
    }

    const followupText = buildDesignFollowupInstructions(row);
    const textSent = followupText.trim()
      ? await delivery.sendText({
          phone: row.whatsapp,
          chatId: imageSent.chatId,
          text: followupText
        })
      : null;

    await adapter.markDeliverySuccess(row.id, {
      attempts,
      chatId: imageSent.chatId,
      imageMessageId: imageSent.messageId,
      textMessageId: textSent?.messageId || '',
      assetPath: asset.path || resolvedAsset?.path || '',
      designResult: row.design_result
    });
    state.delivered += 1;
    state.lastDeliveryErrorCode = null;
    return {
      delivered: true,
      chatId: imageSent.chatId,
      imageMessageId: imageSent.messageId,
      textMessageId: textSent?.messageId || null,
      reusedImage: imageSent.reused === true
    };
  } catch (error) {
    const errorCode = String(error?.code || 'DESIGN_DELIVERY_FAILED');
    await adapter.markDeliveryFailure(row.id, errorCode, attempts, {
      chatId: imageSent?.chatId || '',
      imageMessageId: imageSent?.messageId || '',
      assetPath: asset?.path || resolvedAsset?.path || '',
      designResult: row.design_result
    });
    state.deliveryFailed += 1;
    state.lastDeliveryErrorCode = errorCode;
    return { delivered: false, errorCode };
  }
}

async function runDesignPortalWorkerOnce(dependencies = {}) {
  const adapter = dependencies.adapter || createDesignPortalSupabaseAdapter();
  const pending = await adapter.getNextPending();
  state.lastRunAt = new Date().toISOString();
  if (!pending) return { processed: false, reason: 'QUEUE_EMPTY' };

  const claimed = await adapter.claimRequest(
    pending.id,
    pending.processing_attempts
  );
  if (!claimed) return { processed: false, reason: 'CLAIM_LOST' };
  state.lastRequestCode = claimed.request_code;

  try {
    const result = await processClaimedRequest(claimed, {
      ...dependencies,
      adapter
    });
    const completed = await adapter.completeRequest(claimed.id, result);
    if (!completed) {
      const error = new Error('DESIGN_COMPLETE_REQUEST_FAILED');
      error.code = 'DESIGN_COMPLETE_REQUEST_FAILED';
      throw error;
    }

    const delivery = await deliverCompletedRequest(completed, {
      ...dependencies,
      adapter
    });

    state.processed += 1;
    state.lastErrorCode = null;
    return {
      processed: true,
      requestCode: claimed.request_code,
      result,
      delivery
    };
  } catch (error) {
    const errorCode = String(error?.code || 'DESIGN_PROCESSING_FAILED');
    if (Number(claimed.processing_attempts || 0) < 3 && adapter.retryRequest) {
      await adapter.retryRequest(claimed.id, errorCode);
    } else {
      await adapter.failRequest(claimed.id, errorCode);
    }
    state.failed += 1;
    state.lastErrorCode = errorCode;
    return { processed: false, requestCode: claimed.request_code, errorCode };
  }
}

function startDesignPortalWorker({
  intervalMs = Number(process.env.DESIGN_PORTAL_WORKER_INTERVAL_MS || 5000),
  runOnce = runDesignPortalWorkerOnce
} = {}) {
  let recoveryCompleted = false;
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      if (!recoveryCompleted) {
        const recoveryAdapter = createDesignPortalSupabaseAdapter();
        await recoveryAdapter.recoverStaleRequests();
        recoveryCompleted = true;
      }
      await runOnce();
    } catch (error) {
      state.lastErrorCode = String(error?.code || 'DESIGN_WORKER_UNAVAILABLE');
    } finally {
      state.running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, Math.max(1000, intervalMs));
  timer.unref();
  return timer;
}

function getDesignPortalWorkerState() {
  return Object.freeze({
    running: state.running,
    processed: state.processed,
    failed: state.failed,
    delivered: state.delivered,
    deliveryFailed: state.deliveryFailed,
    lastRunAt: state.lastRunAt,
    lastErrorCode: state.lastErrorCode,
    lastDeliveryErrorCode: state.lastDeliveryErrorCode
  });
}

module.exports = {
  buildCommonRequest,
  buildMeasurements,
  deliverCompletedRequest,
  ensureProcessed,
  getDesignPortalWorkerState,
  processClaimedRequest,
  runDesignPortalWorkerOnce,
  sanitizeNotes,
  startDesignPortalWorker,
  toInlineReference
};
