const { execFile } = require('node:child_process');

const DOCKER_BIN = '/usr/bin/docker';
const TIMEOUT_MS = 5000;

function execDocker(args) {
  return new Promise((resolve, reject) => {
    execFile(
      DOCKER_BIN,
      args,
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
}

function parseJsonLines(output) {
  if (!output) return [];

  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function listContainers() {
  const output = await execDocker([
    'ps',
    '--all',
    '--format',
    '{{json .}}'
  ]);

  return parseJsonLines(output).map((container) => ({
    name: container.Names,
    state: container.State,
    status: container.Status,
    running: container.State === 'running'
  }));
}

async function getContainerStats() {
  const output = await execDocker([
    'stats',
    '--no-stream',
    '--format',
    '{{json .}}'
  ]);

  return parseJsonLines(output).map((stats) => ({
    name: stats.Name,
    cpu: stats.CPUPerc,
    memory_usage: stats.MemUsage,
    memory_percent: stats.MemPerc,
    processes: stats.PIDs
  }));
}

async function getDockerStatus() {
  const [containers, stats] = await Promise.all([
    listContainers(),
    getContainerStats()
  ]);

  const statsByName = new Map(
    stats.map((item) => [item.name, item])
  );

  const safeContainers = containers.map((container) => ({
    ...container,
    stats: statsByName.get(container.name) || null
  }));

  return {
    available: true,
    total: safeContainers.length,
    running: safeContainers.filter((item) => item.running).length,
    stopped: safeContainers.filter((item) => !item.running).length,
    containers: safeContainers,
    checked_at: new Date().toISOString()
  };
}

module.exports = {
  getDockerStatus
};
