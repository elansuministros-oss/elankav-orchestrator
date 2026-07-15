'use strict';

const { createDesignPortalSupabaseAdapter } = require('../adapters/designPortalSupabaseAdapter');
const { fetchDesignAsset } = require('../adapters/designEngineAdapter');
const { processDesignRequest } = require('./designEngineService');

const SUPPORTED_REFERENCE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const state = {
  running: false,
  processed: 0,
  failed: 0,
  lastRunAt: null,
  lastRequestCode: null,
  lastErrorCode: null
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
    await adapter.completeRequest(claimed.id, result);
    state.processed += 1;
    state.lastErrorCode = null;
    return { processed: true, requestCode: claimed.request_code, result };
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
    lastRunAt: state.lastRunAt,
    lastErrorCode: state.lastErrorCode
  });
}

module.exports = {
  buildCommonRequest,
  buildMeasurements,
  ensureProcessed,
  getDesignPortalWorkerState,
  processClaimedRequest,
  runDesignPortalWorkerOnce,
  sanitizeNotes,
  startDesignPortalWorker,
  toInlineReference
};
