'use strict';

const { spawn } = require('node:child_process');

const REFRESH_DELAY_SECONDS = Math.max(
  30,
  Number(process.env.OWNER_OPS_SUPERVISOR_REFRESH_DELAY_SECONDS) || 60
);

function scheduleSupervisorRefresh() {
  if (process.platform !== 'linux') return false;
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return false;

  const child = spawn(
    '/bin/sh',
    [
      '-c',
      `sleep ${REFRESH_DELAY_SECONDS}; systemctl restart elankav-owner-ops-supervisor.service >/dev/null 2>&1 || true`
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
    console.log(`OWNER_OPS_SUPERVISOR_REFRESH_SCHEDULED:${REFRESH_DELAY_SECONDS}s`);
  }
}

module.exports = {
  REFRESH_DELAY_SECONDS,
  scheduleSupervisorRefresh
};
