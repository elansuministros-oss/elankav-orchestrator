'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_STORE_DIR = '/var/lib/elankav/orchestrator/seller-business-context';
const ALLOWED_KEYS = new Set([
  'activeCustomerId',
  'activeQuotationId',
  'activeQuotationNumber',
  'activeQuotationPublicUrl',
  'activeProjectId',
  'lastQuotationTotalUsd',
  'lastEntityType',
  'lastEntityId',
  'pendingQuotation',
  'pendingQuotationCustomer'
]);

function cleanSellerId(value) {
  const id = String(value || '').trim();
  if (!id) {
    const error = new Error('SELLER_ID_REQUIRED');
    error.code = 'SELLER_ID_REQUIRED';
    throw error;
  }
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function storeDir(env = process.env) {
  return String(env.SELLER_BUSINESS_CONTEXT_STORE_DIR || DEFAULT_STORE_DIR).trim() || DEFAULT_STORE_DIR;
}

function storePath(sellerId, env = process.env) {
  return path.join(storeDir(env), `${cleanSellerId(sellerId)}.json`);
}

async function readSellerContext(sellerId, env = process.env) {
  try {
    const raw = await fs.readFile(storePath(sellerId, env), 'utf8');
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeSellerContext(sellerId, context, env = process.env) {
  const file = storePath(sellerId, env);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

async function updateSellerContext(sellerId, patch = {}, env = process.env) {
  const current = await readSellerContext(sellerId, env);
  const sanitized = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!ALLOWED_KEYS.has(key)) continue;
    sanitized[key] = value === undefined ? null : value;
  }
  const next = {
    ...current,
    ...sanitized,
    sellerId: String(sellerId),
    updatedAt: new Date().toISOString()
  };
  await writeSellerContext(sellerId, next, env);
  return next;
}

async function clearSellerContext(sellerId, env = process.env) {
  await writeSellerContext(sellerId, {
    sellerId: String(sellerId),
    updatedAt: new Date().toISOString()
  }, env);
  return {};
}

module.exports = {
  ALLOWED_KEYS,
  DEFAULT_STORE_DIR,
  clearSellerContext,
  readSellerContext,
  updateSellerContext
};
