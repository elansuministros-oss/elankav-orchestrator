'use strict';

const { spawn } = require('node:child_process');

function scheduleSupervisorRefresh() {
  if (process.platform !== 'linux') return false;
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return false;

  const child = spawn(
    '/bin/sh',
    ['-c', 'sleep 8; systemctl restart elankav-owner-ops-supervisor.service >/dev/null 2>&1 || true'],
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
  if (scheduled) console.log('OWNER_OPS_SUPERVISOR_REFRESH_SCHEDULED');
}

module.exports = { scheduleSupervisorRefresh };
