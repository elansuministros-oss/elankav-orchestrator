'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_STORE_PATH = '/var/lib/elankav/orchestrator/owner-ops-operations.json';

function getStorePath(env = process.env) {
  return String(env.OWNER_OPS_STORE_PATH || DEFAULT_STORE_PATH).trim() || DEFAULT_STORE_PATH;
}

async function readStore(env = process.env) {
  const storePath = getStorePath(env);
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStore(data, env = process.env) {
  const storePath = getStorePath(env);
  const dir = path.dirname(storePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${storePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, storePath);
}

async function saveOperation(operation, env = process.env) {
  const store = await readStore(env);
  store[operation.id] = operation;
  await writeStore(store, env);
  return JSON.parse(JSON.stringify(operation));
}

async function getOperation(id, env = process.env) {
  const store = await readStore(env);
  const value = store[id];
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

async function updateOperation(id, changes, env = process.env) {
  const current = await getOperation(id, env);
  if (!current) return null;
  const updated = {
    ...current,
    ...changes,
    updatedAt: new Date().toISOString()
  };
  return saveOperation(updated, env);
}

module.exports = {
  DEFAULT_STORE_PATH,
  getOperation,
  getStorePath,
  readStore,
  saveOperation,
  updateOperation,
  writeStore
};