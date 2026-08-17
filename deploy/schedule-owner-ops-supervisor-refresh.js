'use strict';

const { spawn } = require('node:child_process');

const REFRESH_DELAY_SECONDS = Math.max(
  30,
  Number(process.env.OWNER_OPS_SUPERVISOR_REFRESH_DELAY_SECONDS) || 60
);
const PROCESSING_DIR = process.env.OWNER_OPS_SUPERVISOR_PROCESSING_DIR || '/var/lib/elankav-owner-ops/processing';
const MAX_WAIT_SECONDS = Math.max(
  120,
  Number(process.env.OWNER_OPS_SUPERVISOR_REFRESH_MAX_WAIT_SECONDS) || 900
);

function scheduleSupervisorRefresh() {
  if (process.platform !== 'linux') return false;
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return false;

  const child = spawn(
    '/bin/sh',
    [
      '-c',
      [
        `sleep ${REFRESH_DELAY_SECONDS}`,
        'waited=0',
        `while find "${PROCESSING_DIR}" -maxdepth 1 -type f -name 'OPS-*.json' -print -quit 2>/dev/null | grep -q .; do`,
        `  if [ "$waited" -ge ${MAX_WAIT_SECONDS} ]; then exit 0; fi`,
        '  sleep 5',
        '  waited=$((waited + 5))',
        'done',
        'sleep 2',
        'systemctl restart elankav-owner-ops-supervisor.service >/dev/null 2>&1 || true'
      ].join('; ')
    ],
    {
      detached: true,
      stdio: 'ignore'
    }
  );
  child.unref();
  return true;
}

if (require.main === module) {
  const scheduled = scheduleSupervisorRefresh();
  if (scheduled) {
    console.log(`OWNER_OPS_SUPERVISOR_REFRESH_SCHEDULED:${REFRESH_DELAY_SECONDS}s SAFE_WAIT:${MAX_WAIT_SECONDS}s`);
  }
}

module.exports = {
  REFRESH_DELAY_SECONDS,
  PROCESSING_DIR,
  MAX_WAIT_SECONDS,
  scheduleSupervisorRefresh
};
