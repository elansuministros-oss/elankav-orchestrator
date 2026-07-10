const os = require('node:os');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatSeconds(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return {
    seconds,
    formatted: `${days}d ${hours}h ${minutes}m`
  };
}

function getMemoryStatus() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;

  return {
    total_bytes: totalBytes,
    used_bytes: usedBytes,
    free_bytes: freeBytes,
    total_gb: round(totalBytes / 1024 ** 3),
    used_gb: round(usedBytes / 1024 ** 3),
    free_gb: round(freeBytes / 1024 ** 3),
    usage_percent: round((usedBytes / totalBytes) * 100)
  };
}

function getCpuStatus() {
  const cpus = os.cpus();

  return {
    model: cpus[0]?.model || null,
    cores: cpus.length,
    load_average: {
      one_minute: round(os.loadavg()[0]),
      five_minutes: round(os.loadavg()[1]),
      fifteen_minutes: round(os.loadavg()[2])
    }
  };
}

async function getDiskStatus() {
  try {
    const { stdout } = await execFileAsync(
      'df',
      ['-B1', '--output=size,used,avail,pcent', '/'],
      {
        timeout: 5000,
        maxBuffer: 1024 * 1024
      }
    );

    const lines = stdout
      .trim()
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const values = lines[lines.length - 1].split(/\s+/);

    const totalBytes = Number(values[0]);
    const usedBytes = Number(values[1]);
    const availableBytes = Number(values[2]);
    const usagePercent = Number(
      String(values[3]).replace('%', '')
    );

    return {
      available: true,
      total_bytes: totalBytes,
      used_bytes: usedBytes,
      free_bytes: availableBytes,
      total_gb: round(totalBytes / 1024 ** 3),
      used_gb: round(usedBytes / 1024 ** 3),
      free_gb: round(availableBytes / 1024 ** 3),
      usage_percent: usagePercent
    };
  } catch (error) {
    return {
      available: false,
      error: error.message
    };
  }
}

function getProcessStatus() {
  const usage = process.memoryUsage();

  return {
    pid: process.pid,
    uptime: formatSeconds(process.uptime()),
    memory: {
      rss_mb: round(usage.rss / 1024 ** 2),
      heap_total_mb: round(usage.heapTotal / 1024 ** 2),
      heap_used_mb: round(usage.heapUsed / 1024 ** 2),
      external_mb: round(usage.external / 1024 ** 2)
    }
  };
}

async function getSystemData() {
  const disk = await getDiskStatus();

  return {
    available: true,
    healthy: disk.available,
    hostname: os.hostname(),
    platform: os.platform(),
    architecture: os.arch(),
    kernel: os.release(),
    node_version: process.version,
    system_uptime: formatSeconds(os.uptime()),
    cpu: getCpuStatus(),
    memory: getMemoryStatus(),
    disk,
    process: getProcessStatus(),
    checked_at: new Date().toISOString()
  };
}

module.exports = {
  formatSeconds,
  getMemoryStatus,
  getCpuStatus,
  getDiskStatus,
  getProcessStatus,
  getSystemData
};
