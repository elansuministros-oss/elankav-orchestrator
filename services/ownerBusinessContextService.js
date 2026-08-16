'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_STORE_PATH = '/var/lib/elankav/orchestrator/owner-business-context.json';
const ALLOWED_KEYS = new Set([
  'activeCustomerId',
  'activeQuotationId',
  'activeProjectId',
  'activeWorkOrderId',
  'lastEntityType',
  'lastEntityId'
]);

function storePath(env = process.env) {
  return String(env.OWNER_BUSINESS_CONTEXT_STORE_PATH || DEFAULT_STORE_PATH).trim() || DEFAULT_STORE_PATH;
}

async function readContext(env = process.env) {
  try {
    const raw = await fs.readFile(storePath(env), 'utf8');
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeContext(context, env = process.env) {
  const file = storePath(env);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

async function updateContext(patch = {}, env = process.env) {
  const current = await readContext(env);
  const sanitized = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!ALLOWED_KEYS.has(key)) continue;
    sanitized[key] = value === undefined ? null : value;
  }
  const next = { ...current, ...sanitized, updatedAt: new Date().toISOString() };
  await writeContext(next, env);
  return next;
}

async function clearContext(env = process.env) {
  await writeContext({ updatedAt: new Date().toISOString() }, env);
  return {};
}

module.exports = {
  ALLOWED_KEYS,
  DEFAULT_STORE_PATH,
  clearContext,
  readContext,
  updateContext
};
