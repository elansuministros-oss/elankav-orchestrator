'use strict';

const { QuotationAssetPersistenceService } = require('../services/vqs/quotationAssetPersistenceService');

const ROUTE = '/api/vqs/assets';
const MAX_BODY_BYTES = 12 * 1024 * 1024;
let service = null;

function pathnameOf(url = '') {
  try { return new URL(url, 'http://localhost').pathname; }
  catch { return ''; }
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error('La imagen excede el tamaño permitido');
        error.code = 'VQS_ASSET_PAYLOAD_TOO_LARGE';
        error.statusCode = 413;
        fail(error);
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', fail);
    req.on('end', () => {
      if (settled) return;
      try {
        settled = true;
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        const error = new Error('JSON inválido');
        error.code = 'VQS_ASSET_INVALID_JSON';
        error.statusCode = 400;
        fail(error);
      }
    });
  });
}

function getService() {
  if (!service) service = new QuotationAssetPersistenceService();
  return service;
}

function resetVqsQuotationAssetApiForTests() {
  service = null;
}

async function handleVqsQuotationAssetApi({ req, res, sendJson, assetService } = {}) {
  if (pathnameOf(req?.url) !== ROUTE) return false;

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    sendJson(res, 405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Método no permitido' });
    return true;
  }

  try {
    const body = await readJsonBody(req);
    const persisted = await (assetService || getService()).persistDataUrl(body.dataUrl, {
      platformId: body.platform || req.headers?.['x-elankav-platform'] || 'ELANVISUAL',
      itemId: body.itemId || 'item',
      assetId: body.assetId || body.uploadToken || ''
    });

    if (!persisted) {
      sendJson(res, 422, {
        success: false,
        code: 'VQS_ASSET_INVALID_IMAGE',
        error: 'La imagen debe ser JPG, PNG o WEBP'
      });
      return true;
    }

    sendJson(res, 201, { success: true, data: persisted });
    return true;
  } catch (error) {
    const status = error.statusCode || (error.code === 'VQS_ASSET_TOO_LARGE' ? 413 : 422);
    sendJson(res, status, {
      success: false,
      code: error.code || 'VQS_ASSET_UPLOAD_FAILED',
      error: error.message || 'No fue posible subir la imagen'
    });
    return true;
  }
}

module.exports = {
  handleVqsQuotationAssetApi,
  readJsonBody,
  resetVqsQuotationAssetApiForTests,
  ROUTE,
  MAX_BODY_BYTES
};
