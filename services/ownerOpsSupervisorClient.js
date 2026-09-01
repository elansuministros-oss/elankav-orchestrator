'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const BASE_DIR = process.env.OWNER_OPS_SUPERVISOR_DIR || '/var/lib/elankav-owner-ops';
const REQUEST_DIR = path.join(BASE_DIR, 'requests');
const RESULT_DIR = path.join(BASE_DIR, 'results');

async function ensureDirs() {
  await fs.mkdir(REQUEST_DIR, { recursive: true, mode: 0o700 });
  await fs.mkdir(RESULT_DIR, { recursive: true, mode: 0o700 });
}

function assertOperationId(id) {
  if (!/^OPS-\d+-[A-Z0-9]{6}$/.test(String(id || ''))) {
    const error = new Error('OWNER_OPS_INVALID_OPERATION_ID');
    error.code = 'OWNER_OPS_INVALID_OPERATION_ID';
    throw error;
  }
}

async function enqueueSupervisorOperation({ id, capability, target, parameters = {}, executeAfterMs = 1500 }) {
  assertOperationId(id);
  await ensureDirs();

  const now = Date.now();
  const payload = {
    schemaVersion: 1,
    id,
    capability,
    target,
    parameters,
    requestedAt: new Date(now).toISOString(),
    executeAfter: new Date(now + Math.max(500, Number(executeAfterMs) || 1500)).toISOString()
  };

  const finalPath = path.join(REQUEST_DIR, `${id}.json`);
  const tempPath = `${finalPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600, flag: 'wx' });
  await fs.rename(tempPath, finalPath);

  return payload;
}

async function readSupervisorResult(id) {
  assertOperationId(id);
  await ensureDirs();
  try {
    const raw = await fs.readFile(path.join(RESULT_DIR, `${id}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

module.exports = {
  BASE_DIR,
  REQUEST_DIR,
  RESULT_DIR,
  enqueueSupervisorOperation,
  readSupervisorResult
};
